// G5 submission endpoint: receives a signed benchmark entry, opens the
// website PR machine-to-machine. NO auth needed — the entry IS the auth
// (CI runs the grounded admission rule and only green PRs merge). This
// Worker is a dumb, rate-limited courier.
export default {
  async fetch(req, env) {
    if (req.method !== "POST" || new URL(req.url).pathname !== "/submit")
      return new Response("POST /submit", { status: 404 });
    let entry;
    try { entry = await req.json(); } catch { return new Response("not JSON", { status: 400 }); }
    const body = JSON.stringify(entry);
    if (body.length > 200_000) return new Response("too large", { status: 413 });
    if (!entry.payload_b64 || !entry.signature_b64 || !entry.publisher_pubkey_hex)
      return new Response("not an entry envelope", { status: 422 });
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)))]
      .map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
    const gh = (path, init = {}) => fetch(`https://api.github.com/repos/auspexai/website${path}`, {
      ...init,
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, "user-agent": "auspexai-board-submit",
                 accept: "application/vnd.github+json", ...(init.headers || {}) },
    });
    const branch = `entry-${hash}`;
    // Dedupe: same bytes = same branch.
    if ((await gh(`/git/ref/heads/${branch}`)).ok)
      return Response.json({ status: "already-submitted", branch });
    const main = await (await gh("/git/ref/heads/main")).json();
    const mk = await gh("/git/refs", { method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: main.object.sha }) });
    if (!mk.ok) return new Response("branch failed", { status: 502 });
    const put = await gh(`/contents/entries/entry-${hash}.json`, { method: "PUT",
      body: JSON.stringify({ message: `entry: ${hash} (researcher-push)`, branch,
        content: btoa(unescape(encodeURIComponent(body))) }) });
    if (!put.ok) return new Response("file failed", { status: 502 });
    const pr = await (await gh("/pulls", { method: "POST",
      body: JSON.stringify({ title: `benchmark entry ${hash}`, head: branch, base: "main",
        body: "Machine-submitted signed entry. CI runs the grounded admission rule; merges only on green." }) })).json();
    return Response.json({ status: "submitted", pr: pr.html_url });
  },
};
