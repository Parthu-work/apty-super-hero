/**
 * The KB pipeline's failure alert (KB-RAG K28, A3): opens one GitHub issue
 * labelled `kb-pipeline`, or comments on the one already open, with the run
 * link and the failing steps' names (no card text). The first green run
 * after a failure (KB-RAG K29, P1) comments "Green again" and closes it. The
 * workflows call it from actions/github-script with their own GITHUB_TOKEN
 * (`issues: write`).
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
    "The first green run of this workflow closes this issue; the next failure opens a new one.",
  ].join("\n");

async function openAlerts({ github, owner, repo }) {
  const { data: open } = await github.rest.issues.listForRepo({
    owner,
    repo,
    labels: ALERT_LABEL,
    state: "open",
    sort: "created",
    direction: "asc",
    per_page: 100,
  });
  return open.filter((issue) => !issue.pull_request);
}

const FAILED_WORKFLOW = /^\*\*(.+?)\*\* failed: /;

/** The workflow named by the issue's latest failure alert, its body or a comment. */
async function lastFailedWorkflow({ github, owner, repo, issue }) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issue.number,
    per_page: 100,
  });
  const alerts = [issue.body ?? "", ...comments.map((c) => c.body ?? "")]
    .map((body) => FAILED_WORKFLOW.exec(body)?.[1])
    .filter(Boolean);
  return alerts.at(-1);
}

/**
 * Closes each open kb-pipeline issue whose latest failure was this
 * workflow's, with a "Green again" comment. Another workflow still failing
 * keeps the issue open.
 */
export async function resolveAlert({ github, owner, repo, workflow, runUrl }) {
  const numbers = [];
  for (const issue of await openAlerts({ github, owner, repo })) {
    const failed = await lastFailedWorkflow({ github, owner, repo, issue });
    if (failed && failed !== workflow) continue;
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: issue.number,
      body: `Green again: ${runUrl}`,
    });
    await github.rest.issues.update({
      owner,
      repo,
      issue_number: issue.number,
      state: "closed",
      state_reason: "completed",
    });
    numbers.push(issue.number);
  }
  return { action: numbers.length > 0 ? "closed" : "none", numbers };
}

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
  const body = alertBody({ workflow, runUrl, failures });
  const [existing] = await openAlerts({ github, owner, repo });
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

const runLink = (context) => {
  const { owner, repo } = context.repo;
  return `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
};

/** Closes the alert after a green run, as the github-script step calls it. */
export async function recoverForRun({ github, context, workflow }) {
  const { owner, repo } = context.repo;
  return resolveAlert({
    github,
    owner,
    repo,
    workflow,
    runUrl: runLink(context),
  });
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
    runUrl: runLink(context),
    failures: failingSteps(jobs),
  });
}
