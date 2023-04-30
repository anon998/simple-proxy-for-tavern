export default ({ user, assistant, messages, config, generationConfig }) => {
  let systemPrompt = `## ${assistant}
- You're "${assistant}" in this never-ending roleplay with "${user}".`;
  let newConversation = `### New Roleplay:`;
  let context = `### Input:\n`;
  let contextResponse = `### Response:\n(OOC) Understood. I will have this info into account for the roleplay. (end OOC)`;
  //     let replyInstruction = `(OOC) Write only ${assistant} next reply in this roleplay.
  // - Don't take control of ${user}.
  // - **Always** stay in character and be creative, writing with ${assistant}'s style and personality.
  // - Write at least two paragraphs. (end OOC)`;
  let replyInstruction = ``;
  let impersonationInstruction = `Write ${user}'s next reply in this fictional roleplay with ${assistant}.`;
  let userName = (attributes = "") =>
    `### Instruction${attributes}:\n#### ${user}:\n`;
  let assistantName = (attributes = "") =>
    `### Response${attributes}:\n#### ${assistant}:\n`;
  let replyAttributes = config.replyAttributes;
  let mainPromptAdded = false;
  let impersonationPromptFound = false;

  let beforeSystem = "\n\n";
  let afterSystem = "\n";
  let beforeUser = "\n\n";
  let afterUser = "\n";
  let beforeAssistant = "\n\n";
  let afterAssistant = "\n";

  let prompt = [];
  if (systemPrompt) {
    prompt.push({
      role: "system",
      type: "system-prompt",
      prunable: false,
      content: `${beforeSystem}${systemPrompt}${afterSystem}`,
    });
  }

  let i = 0;
  for (let { role, content, name } of messages) {
    content = content.trim();
    if (role === "system") {
      if (content === "[Start a new chat]") {
        if (newConversation) {
          prompt.push({
            role: "system",
            type: "new-conversation",
            prunable: false,
            content: `${beforeSystem}${newConversation}${afterSystem}`,
          });
        }
      } else if (!mainPromptAdded) {
        mainPromptAdded = true;
        prompt.push({
          role: "system",
          type: "context",
          prunable: false,
          content: `${beforeSystem}${context}${content}${afterSystem}`,
        });
        if (contextResponse) {
          prompt.push({
            role: "assistant",
            type: "context-response",
            prunable: false,
            content: `${beforeAssistant}${contextResponse}${afterAssistant}`,
          });
        }
      } else if (content === "IMPERSONATION_PROMPT") {
        impersonationPromptFound = true;
      } else if (name === "example_assistant") {
        prompt.push({
          role: "assistant",
          type: "example-conversation",
          prunable: !config.keepExampleMessagesInPrompt,
          content: `${beforeAssistant}${assistantName()}${content}${afterAssistant}`,
        });
      } else if (name === "example_user") {
        prompt.push({
          role: "user",
          type: "example-conversation",
          prunable: !config.keepExampleMessagesInPrompt,
          content: `${beforeUser}${userName()}${content}${afterUser}`,
        });
      } else {
        prompt.push({
          role: "system",
          type: "other",
          prunable: false,
          content: `${beforeSystem}${content}${afterSystem}`,
        });
      }
    } else if (role === "assistant") {
      if (i === messages.length - 1) {
        if (replyInstruction) {
          prompt.push({
            role: "system",
            type: "reply-instruction",
            prunable: false,
            content: `${beforeSystem}${replyInstruction}${afterSystem}`,
          });
        }
        prompt.push({
          role: "assistant",
          type: "reply",
          prunable: false,
          content: `${beforeAssistant}${assistantName(
            replyAttributes
          )}${content}`,
        });
      } else {
        prompt.push({
          role: "assistant",
          type: "reply",
          prunable: true,
          content: `${beforeAssistant}${assistantName()}${content}${afterAssistant}`,
        });
      }
    } else if (role === "user") {
      prompt.push({
        role: "user",
        type: "reply",
        prunable: true,
        content: `${beforeUser}${userName()}${content}${afterUser}`,
      });
    }
    i++;
  }

  if (messages[messages.length - 1].role !== "assistant") {
    if (impersonationPromptFound) {
      if (impersonationInstruction) {
        prompt.push({
          role: "system",
          type: "impersonation-instruction",
          prunable: false,
          content: `${beforeSystem}${impersonationInstruction}${afterSystem}`,
        });
      }
      prompt.push({
        role: "user",
        type: "reply-to-complete",
        prunable: false,
        content: `${beforeUser}${userName(replyAttributes)}`,
      });
    } else {
      if (replyInstruction) {
        prompt.push({
          role: "system",
          type: "reply-instruction",
          prunable: false,
          content: `${beforeSystem}${replyInstruction}${afterSystem}`,
        });
      }
      prompt.push({
        role: "assistant",
        type: "reply-to-complete",
        prunable: false,
        content: `${beforeAssistant}${assistantName(replyAttributes)}`,
      });
    }
  }

  return prompt;
};
