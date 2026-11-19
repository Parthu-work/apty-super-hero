/**
 * The KB pipeline's failure alert (KB-RAG K28, A3): opens one GitHub issue
 * labelled `kb-pipeline`, or comments on the one already open, with the run
 * link and the failing steps' names (no card text). The workflows call it
 * from actions/github-script with their own GITHUB_TOKEN (`issues: write`).
 */
export const ALERT_LABEL = "kb-pipeline";
export const ALERT_TITLE = "KB pipeline failing";

/** "job / step" for each failed step of each failed job; the job alone when no step failed. */
export function failingSteps(jobs) {
  return jobs
    .filter((job) => job.conclusion === "failure")
    .flatMap((job) => {
      const steps = (job.steps ?? []).filter(
        (step) => step.conclusion === "failure",
      );
      return steps.length > 0
        ? steps.map((step) => `${job.name} / ${step.name}`)
        : [job.name];
    });
}

const alertBody = ({ workflow, runUrl, failures }) =>
  [
    `**${workflow}** failed: ${runUrl}`,
    "",
    "Failing steps:",
    ...(failures.length > 0 ? failures : ["(not reported)"]).map(
      (name) => `- ${name}`,
    ),
    "",
    "Close this issue once the pipeline is green again; the next failure opens a new one.",
  ].join("\n");

export async function raiseAlert({
  github,
  owner,
  repo,
  workflow,
  runUrl,
  failures,
}) {
  try {
    await github.rest.issues.createLabel({
      owner,
      repo,
      name: ALERT_LABEL,
      color: "b60205",
      description: "The KB pack pipeline failed",
    });
  } catch (error) {
    if (error?.status !== 422) throw error;
  }
  const { data: open } = await github.rest.issues.listForRepo({
    owner,
    repo,
    labels: ALERT_LABEL,
    state: "open",
    sort: "created",
    direction: "asc",
    per_page: 100,
  });
  const body = alertBody({ workflow, runUrl, failures });
  const existing = open.find((issue) => !issue.pull_request);
  if (existing) {
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: existing.number,
      body,
    });
    return { action: "updated", number: existing.number };
  }
  const { data: created } = await github.rest.issues.create({
    owner,
    repo,
    title: ALERT_TITLE,
    labels: [ALERT_LABEL],
    body,
  });
  return { action: "opened", number: created.number };
}

/** The whole alert for the current run, as the github-script step calls it. */
export async function alertForRun({ github, context, workflow }) {
  const { owner, repo } = context.repo;
  const jobs = await github.paginate(
    github.rest.actions.listJobsForWorkflowRun,
    { owner, repo, run_id: context.runId, per_page: 100 },
  );
  return raiseAlert({
    github,
    owner,
    repo,
    workflow,
    runUrl: `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`,
    failures: failingSteps(jobs),
  });
}
