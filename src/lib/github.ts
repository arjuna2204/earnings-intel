import "server-only";

const REPO = "arjuna2204/earnings-intel";
const WORKFLOW = "pipeline.yml";

/** Start the background pipeline in GitHub Actions. */
export async function dispatchPipeline(inputs: { command: "analyze" | "tickers" | "refresh"; ticker?: string; job_id?: number }) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) throw new Error("GITHUB_DISPATCH_TOKEN is not set in Vercel");
  const body = {
    ref: "main",
    inputs: Object.fromEntries(
      Object.entries(inputs)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ),
  };
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status !== 204) {
    throw new Error(`GitHub refused to start the job (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
}
