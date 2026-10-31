// The Apty Client in extension mode: the chat call runs in this service
// worker, as background-script-ipc.service.ts makes it. The test page asks
// for it with the ai-service origin and the message.
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type !== "fake-client:ask-dapty") return false;
  fetch(
    `${request.origin}/ai-service/api/v1/ai/tenant-1/widget/chat?applicationId=app-9`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: request.message,
        context: [],
        envId: "prod",
        applicationType: "web",
      }),
    },
  )
    .then((response) => response.json())
    .then((reply) => sendResponse({ ok: true, reply }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});
