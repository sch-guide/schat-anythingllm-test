const { Telemetry } = require("../models/telemetry");
const {
  WorkspaceAgentInvocation,
} = require("../models/workspaceAgentInvocation");
const { AgentHandler } = require("../utils/agents");
const {
  WEBSOCKET_BAIL_COMMANDS,
} = require("../utils/agents/aibitat/plugins/websocket");
const { safeJsonParse } = require("../utils/http");
const { runtime: admissionRuntime } = require("../utils/chatAdmissionRuntime");
const {
  openSession,
  admissionMessage,
} = require("../utils/chatAdmissionSession");
const { withAdmissionSignal } = require("../utils/chatAdmissionContext");
const connectedInvocations = new Set();

// Setup listener for incoming messages to relay to socket so it can be handled by agent plugin.
function relayToSocket(message) {
  // Tool toggles can arrive while the agent is paused awaiting feedback/approval,
  // so handle them first. The handler ignores (returns false for) any other message.
  if (this.handleToolToggle?.(message)) return;
  if (this.handleFeedback) return this?.handleFeedback?.(message);
  if (this.handleToolApproval) return this?.handleToolApproval?.(message);
  if (this.handleClarificationResponse)
    return this?.handleClarificationResponse?.(message);
  this.checkBailCommand(message);
}

function agentWebsocket(app) {
  if (!app) return;

  app.ws("/agent-invocation/:uuid", async function (socket, request) {
    const invocationId = String(request.params.uuid);
    if (connectedInvocations.has(invocationId)) {
      socket.close();
      return;
    }
    connectedInvocations.add(invocationId);
    let session;
    let agentHandler;
    socket.once("close", () => {
      connectedInvocations.delete(invocationId);
      agentHandler?.aibitat?.abort();
      // openSession's close listener aborts first and then releases the slot.
      // Do not remove it by releasing early while createAIbitat is pending.
    });
    try {
      agentHandler = await new AgentHandler({
        uuid: String(request.params.uuid),
      }).init();

      if (!agentHandler.invocation) {
        socket.close();
        return;
      }
      if (socket.readyState !== socket.OPEN) return;

      socket.on("message", function (message) {
        return withAdmissionSignal(session?.signal, () =>
          relayToSocket.call(this, message)
        );
      });
      socket.on("close", () => {
        // Abort the running agent loop (stop button, tab close, disconnect) so
        // in-flight LLM requests are cancelled and no further turns run.
        agentHandler.aibitat?.abort();
        agentHandler.closeAlert();
        WorkspaceAgentInvocation.close(String(request.params.uuid)).catch(
          () => {}
        );
        return;
      });

      socket.checkBailCommand = (data) => {
        const content = safeJsonParse(data)?.feedback;
        if (WEBSOCKET_BAIL_COMMANDS.includes(content)) {
          agentHandler.log(
            `User invoked bail command while processing. Closing session now.`
          );
          // aibitat may not exist yet if the bail arrives while the session
          // is still being built - closing the socket alone is enough then.
          agentHandler.aibitat?.abort();
          socket.close();
          return;
        }
      };

      const gate = await admissionRuntime.ready();
      session = await openSession(
        gate,
        agentHandler.invocation.user_id ?? "single-user",
        socket,
        {
          onPosition: (position) =>
            socket.send(JSON.stringify({ type: "admissionStatus", position })),
          onAbort: (reason) => {
            agentHandler.aibitat?.abort();
            if (socket.readyState === socket.OPEN) {
              if (reason?.code !== "SCHAT_CANCELLED")
                socket.send(
                  JSON.stringify({
                    type: "wssFailure",
                    content: admissionMessage(reason?.code),
                    errorCode: reason?.code,
                  })
                );
              socket.close();
            }
          },
        }
      );
      session.check();
      socket.send(JSON.stringify({ type: "admissionStatus", position: 0 }));
      await Telemetry.sendTelemetry("agent_chat_started");
      session.check();
      await withAdmissionSignal(session.signal, () =>
        agentHandler.createAIbitat({ socket })
      );
      if (session.signal.aborted) {
        agentHandler.aibitat?.abort();
        session.check();
      }
      // Socket can close while aibitat is being built - don't start a session nobody is listening to.
      if (socket.readyState !== socket.OPEN) return;
      await withAdmissionSignal(session.signal, () =>
        agentHandler.startAgentCluster()
      );
    } catch (e) {
      agentHandler?.aibitat?.abort();
      session?.release();
      console.error(e.message, e);
      if (socket.readyState === socket.OPEN && e?.code !== "SCHAT_CANCELLED")
        socket.send(
          JSON.stringify({
            type: "wssFailure",
            errorCode: e?.code,
            content: e?.code?.startsWith("SCHAT_")
              ? admissionMessage(e.code)
              : e.message,
          })
        );
      socket?.close();
    }
  });
}

module.exports = { agentWebsocket };
