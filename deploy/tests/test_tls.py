import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("tls", Path(__file__).resolve().parents[1] / "tls.py")
tls = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tls)


class TlsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        constants = {
            "PROJECT_DIR": self.root / "project",
            "CERT_DIR": self.root / "certs",
            "LE_DIR": self.root / "letsencrypt",
            "LINEAGE": self.root / "letsencrypt/live/whoami",
            "WEBROOT": self.root / "webroot",
            "STATE_DIR": self.root / "state",
            "HOOK": self.root / "letsencrypt/renewal-hooks/deploy/20-whoami-nginx",
        }
        for key, value in constants.items():
            mocked = patch.object(tls, key, value)
            mocked.start()
            self.addCleanup(mocked.stop)
        files = {name: tls.LINEAGE / leaf for name, leaf in [
            ("domain.cert.pem", "fullchain.pem"), ("private.key.pem", "privkey.pem"),
        ]}
        mocked = patch.object(tls, "CERT_FILES", files)
        mocked.start()
        self.addCleanup(mocked.stop)
        for directory in [tls.PROJECT_DIR, tls.CERT_DIR, tls.LINEAGE,
                          tls.HOOK.parent, tls.STATE_DIR, tls.WEBROOT / ".well-known/acme-challenge"]:
            directory.mkdir(parents=True, exist_ok=True)
        for name, target in files.items():
            (tls.CERT_DIR / name).write_text("old-" + name)
            target.write_text("new-" + name)
        (tls.CERT_DIR / "private.key.pem").chmod(0o600)
        self.args = argparse.Namespace(domain=["example.test"], email="admin@example.test",
                                       project_name=None, agree_tos=True)

    def restore(self, directory):
        # Production requires root-owned backups. Unit tests also run as an ordinary CI user.
        metadata = json.loads((directory / "state.json").read_text())
        for name in tls.CERT_FILES:
            tls.restore(tls.CERT_DIR / name, metadata["files"][name], directory / name)
        tls.restore(tls.HOOK, metadata["files"]["hook"], directory / "hook")

    def test_rejects_urls_wildcards_and_shell_syntax(self):
        for domain in ["*.example.test", "https://example.test", "example.test/abc",
                       "-bad.test", "foo..test", "localhost", "a;id.test"]:
            with self.subTest(domain=domain), self.assertRaises(ValueError):
                tls.validate_domains([domain])
        self.assertEqual(tls.validate_domains(["EXAMPLE.test.", "example.test"]), ["example.test"])

    def test_atomic_link_replaces_file_without_replacing_mounted_directory(self):
        inode = tls.CERT_DIR.stat().st_ino
        tls.atomic_link(tls.CERT_DIR / "domain.cert.pem", tls.LINEAGE / "fullchain.pem")
        self.assertEqual((tls.CERT_DIR / "domain.cert.pem").read_text(), "new-domain.cert.pem")
        self.assertEqual(tls.CERT_DIR.stat().st_ino, inode)
        self.assertEqual(len(list(tls.CERT_DIR.iterdir())), 2)

    def test_backup_restores_files_modes_and_absent_hook(self):
        directory = tls.backup("/usr/bin/docker", "whoami")
        for name, target in tls.CERT_FILES.items():
            tls.atomic_link(tls.CERT_DIR / name, target)
        tls.HOOK.write_text("new hook")
        self.restore(directory)
        self.assertFalse(tls.HOOK.exists())
        self.assertFalse((tls.CERT_DIR / "private.key.pem").is_symlink())
        self.assertEqual((tls.CERT_DIR / "private.key.pem").read_text(), "old-private.key.pem")
        self.assertEqual((tls.CERT_DIR / "private.key.pem").stat().st_mode & 0o777, 0o600)
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual((directory / "private.key.pem").stat().st_mode & 0o777, 0o600)

    def test_backup_preserves_existing_links_and_hook(self):
        path = tls.CERT_DIR / "domain.cert.pem"
        tls.atomic_link(path, tls.LINEAGE / "fullchain.pem")
        tls.HOOK.write_text("previous hook")
        tls.HOOK.chmod(0o750)
        directory = tls.backup("/usr/bin/docker", "custom-project")
        tls.atomic_write(path, b"replacement")
        tls.HOOK.unlink()
        self.restore(directory)
        self.assertTrue(path.is_symlink())
        self.assertEqual(os.readlink(path), str(tls.LINEAGE / "fullchain.pem"))
        self.assertEqual(tls.HOOK.read_text(), "previous hook")
        self.assertEqual(tls.HOOK.stat().st_mode & 0o777, 0o750)

    def test_activation_rolls_back_after_failed_reload_or_https(self):
        for failure in ("reload", "https"):
            with self.subTest(failure=failure):
                with patch.object(tls, "run") as command, \
                     patch.object(tls, "verify_served_certificate") as verify, \
                     patch.object(tls, "restore_backup", side_effect=self.restore) as rollback:
                    if failure == "reload":
                        command.side_effect = RuntimeError("invalid nginx configuration")
                    else:
                        verify.side_effect = RuntimeError("wrong certificate served")
                    with self.assertRaises(RuntimeError):
                        tls.activate("/usr/bin/docker", "whoami", "example.test")
                    rollback.assert_called_once()
                self.assertEqual((tls.CERT_DIR / "domain.cert.pem").read_text(), "old-domain.cert.pem")
                self.assertFalse(tls.HOOK.exists())

    def test_successful_activation_uses_links_and_protected_hook(self):
        with patch.object(tls, "run") as command, patch.object(tls, "verify_served_certificate"):
            tls.activate("/usr/bin/docker", "whoami", "example.test")
        self.assertTrue((tls.CERT_DIR / "private.key.pem").is_symlink())
        self.assertEqual(tls.HOOK.stat().st_mode & 0o777, 0o750)
        self.assertEqual(command.call_args.kwargs["env"]["RENEWED_LINEAGE"], str(tls.LINEAGE))

    def test_http_preflight_checks_each_name_and_cleans_up(self):
        def request(command, **kwargs):
            token = command[-1].rsplit("/", 1)[1]
            self.assertEqual((tls.WEBROOT / ".well-known/acme-challenge" / token).read_text(), token)
            return subprocess.CompletedProcess(command, 0, token)
        with patch.object(tls, "run", side_effect=request) as command:
            tls.check_http(["example.test", "www.example.test"])
            self.assertEqual(command.call_count, 2)
        self.assertEqual(list((tls.WEBROOT / ".well-known/acme-challenge").iterdir()), [])

    def test_http_redirect_or_error_does_not_leave_test_file(self):
        for result in ["", RuntimeError("timeout")]:
            with self.subTest(result=result):
                effect = result if isinstance(result, Exception) else lambda *a, **k: subprocess.CompletedProcess([], 0, "")
                with patch.object(tls, "run", side_effect=effect), self.assertRaises(RuntimeError):
                    tls.check_http(["example.test"])
                self.assertEqual(list((tls.WEBROOT / ".well-known/acme-challenge").iterdir()), [])

    def test_existing_names_cannot_be_silently_dropped(self):
        with patch.object(tls, "run", return_value=subprocess.CompletedProcess([], 0, "DNS:example.test, DNS:www.example.test")):
            with self.assertRaisesRegex(RuntimeError, "Include every"):
                tls.check_existing_names(["example.test"])
            tls.check_existing_names(["example.test", "www.example.test", "new.example.test"])

    def test_mismatched_private_key_is_rejected(self):
        responses = [subprocess.CompletedProcess([], 0, output) for output in [
            "", "Hostname example.test does match certificate\n", "key-one", "key-two",
        ]]
        with patch.object(tls, "run", side_effect=responses), self.assertRaisesRegex(RuntimeError, "do not match"):
            tls.check_certificate(["example.test"])

    def test_second_setup_process_is_rejected(self):
        with tls.setup_lock():
            with self.assertRaisesRegex(RuntimeError, "Another"):
                with tls.setup_lock():
                    pass

    def test_rollback_rejects_untrusted_backup_path(self):
        with self.assertRaisesRegex(RuntimeError, "directly under"):
            tls.restore_backup(self.root)

    def test_https_waits_for_reload_then_requires_matching_fingerprint(self):
        outputs = ["expected", "peer1", "old", "peer2", "expected"]
        with patch.object(tls, "run", side_effect=[
            subprocess.CompletedProcess([], 0, value) for value in outputs
        ]) as command, patch.object(tls.time, "sleep"):
            tls.verify_served_certificate("example.test")
        self.assertEqual(command.call_count, 5)
        self.assertIn("-verify_return_error", command.call_args_list[1].args[0])
        self.assertIn("-verify_hostname", command.call_args_list[1].args[0])

    def test_setup_does_not_switch_certificate_after_failed_http_or_issuance(self):
        for failure in ("http", "issuance"):
            with self.subTest(failure=failure), contextlib.ExitStack() as stack:
                stack.enter_context(patch.object(tls.shutil, "which", return_value="/usr/bin/docker"))
                stack.enter_context(patch.object(tls, "preflight", return_value="whoami"))
                stack.enter_context(patch.object(tls, "check_existing_names"))
                stack.enter_context(patch.object(tls, "certbot_installation", return_value=("/snap/bin/certbot", "timer")))
                stack.enter_context(patch.object(tls, "reload_nginx"))
                http = stack.enter_context(patch.object(tls, "check_http"))
                activate = stack.enter_context(patch.object(tls, "activate"))
                command = stack.enter_context(patch.object(tls, "run"))
                if failure == "http":
                    http.side_effect = RuntimeError("HTTP check failed")
                else:
                    command.side_effect = [None, None, RuntimeError("issuance failed")]
                with self.assertRaises(RuntimeError):
                    tls.setup(self.args)
                activate.assert_not_called()
                self.assertEqual((tls.CERT_DIR / "private.key.pem").read_text(), "old-private.key.pem")

    def test_failed_dry_run_keeps_working_certificate(self):
        def command(args, **kwargs):
            if "--dry-run" in args:
                raise RuntimeError("staging unreachable")
            return subprocess.CompletedProcess(args, 0, "")
        with patch.object(tls.shutil, "which", return_value="/usr/bin/docker"), \
             patch.object(tls, "preflight", return_value="whoami"), \
             patch.object(tls, "check_existing_names"), \
             patch.object(tls, "certbot_installation", return_value=("/snap/bin/certbot", "timer")), \
             patch.object(tls, "reload_nginx"), \
             patch.object(tls, "check_http"), \
             patch.object(tls, "check_certificate"), \
             patch.object(tls, "verify_served_certificate"), \
             patch.object(tls, "run", side_effect=command), \
             patch.object(tls, "restore_backup") as rollback, \
             self.assertRaisesRegex(RuntimeError, "staging"):
            tls.setup(self.args)
        rollback.assert_not_called()
        self.assertTrue((tls.CERT_DIR / "private.key.pem").is_symlink())
        self.assertTrue(tls.HOOK.exists())


class OpenSslTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.lineage = Path(cls.temp.name)
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
            "-subj", "/CN=example.test", "-addext", "subjectAltName=DNS:example.test,DNS:www.example.test",
            "-keyout", str(cls.lineage / "privkey.pem"), "-out", str(cls.lineage / "fullchain.pem"),
        ], check=True, capture_output=True)

    def test_real_certificate_matches_all_requested_names_and_key(self):
        with patch.object(tls, "LINEAGE", self.lineage):
            tls.check_certificate(["example.test", "www.example.test"])

    def test_missing_name_is_rejected_despite_openssl_zero_exit_status(self):
        with patch.object(tls, "LINEAGE", self.lineage), self.assertRaisesRegex(RuntimeError, "does not cover wrong.test"):
            tls.check_certificate(["example.test", "wrong.test"])


class HookTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.log = self.root / "calls.jsonl"
        docker = self.root / "fake docker"
        docker.write_text("""#!/usr/bin/env python3
import json, os, sys
with open(os.environ["TEST_DOCKER_LOG"], "a") as log:
    log.write(json.dumps(sys.argv[1:]) + "\\n")
if sys.argv[1] == "ps":
    print(os.environ.get("TEST_DOCKER_IDS", "container-one"))
if sys.argv[-1] == "-t":
    sys.exit(int(os.environ.get("TEST_NGINX_TEST_EXIT", "0")))
""")
        docker.chmod(0o755)
        self.hook = self.root / "hook"
        self.hook.write_bytes(tls.hook_content(str(docker), "custom-project"))
        self.hook.chmod(0o750)
        self.env = {**os.environ, "TEST_DOCKER_LOG": str(self.log), "RENEWED_LINEAGE": str(tls.LINEAGE)}

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_reloads_current_container_and_uses_project_label(self):
        for container in ["container-one", "new-container"]:
            self.env["TEST_DOCKER_IDS"] = container
            subprocess.run([self.hook], env=self.env, check=True)
            self.assertEqual(self.calls()[-2:], [
                ["exec", container, "nginx", "-t"],
                ["exec", container, "nginx", "-s", "reload"],
            ])
        self.assertIn("label=com.docker.compose.project=custom-project", self.calls()[0])

    def test_ignores_unrelated_certificate(self):
        self.env["RENEWED_LINEAGE"] = "/etc/letsencrypt/live/another-site"
        subprocess.run([self.hook], env=self.env, check=True)
        self.assertEqual(self.calls(), [])

    def test_missing_or_ambiguous_container_fails_without_reload(self):
        for ids in ["", "container-one\ncontainer-two"]:
            self.env["TEST_DOCKER_IDS"] = ids
            result = subprocess.run([self.hook], env=self.env, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
        self.assertTrue(all(call[0] == "ps" for call in self.calls()))

    def test_invalid_nginx_configuration_does_not_reload(self):
        self.env["TEST_NGINX_TEST_EXIT"] = "1"
        result = subprocess.run([self.hook], env=self.env, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("reload" in call for call in self.calls()))


if __name__ == "__main__":
    unittest.main()
