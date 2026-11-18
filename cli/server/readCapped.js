// Read an upstream body without holding more than `max` bytes of it (plus one
// chunk). The downloads used to buffer the whole body and measure it afterwards,
// so a 200 MB response cost 838 MB of RSS before the cap said no. Returns a
// Buffer, or null when the body is over the cap; leaving the loop cancels the
// stream and the connection is dropped.
export async function readCapped(res, max) {
  if (Number(res.headers.get("content-length")) > max) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const chunks = [];
  let n = 0;
  for await (const chunk of res.body ?? []) {
    n += chunk.length;
    if (n > max) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, n);
}
