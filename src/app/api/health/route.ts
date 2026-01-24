export async function GET() {
  return Response.json({
    ok: true,
    service: "whoami",
    ts: new Date().toISOString()
  });
}

