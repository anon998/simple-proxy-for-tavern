import {
  getLastChatMessage,
  popLastAssistantMessage,
  replaceTemplates,
} from "../src/utils.mjs";

export default ({ user, assistant, messages, config, generationConfig }) => {
  const systemPrompt = `## ${assistant}
- You're "${assistant}" in this never-ending roleplay with "${user}".`;
  const newConversation = `### New Roleplay:`;
  const newExample = newConversation;
  const context = `### Input:\n`;
  const contextResponse = `### Response:\n(OOC) Understood. I will take this info into account for the roleplay. (end OOC)`;
  const replyAttributes = replaceTemplates(config.replyAttributes, config);
  const characterBias = replaceTemplates(config.characterBias, config);
  const impersonationPrompt = replaceTemplates(
    config.impersonationPrompt,
    config
  );
  const silentMessage = replaceTemplates(config.silentMessage, config);

  let impersonationPromptFound = false;

  const userName = (attributes = "") =>
    `### Instruction${attributes}:\n#### ${user}:\n`;
  const assistantName = (attributes = "") =>
    `### Response${attributes}:\n#### ${assistant}:\n`;

  const beforeSystem = "\n\n";
  const afterSystem = "\n";
  const beforeUser = "\n\n";
  const afterUser = "\n";
  const beforeAssistant = "\n\n";
  const afterAssistant = "\n";

  let prompt = [];
  if (systemPrompt) {
    prompt.push({
      role: "system",
      metadata: { type: "system-prompt" },
      prunable: false,
      content: `${beforeSystem}${systemPrompt}${afterSystem}`,
    });
  }

  for (const msg of messages) {
    const { metadata } = msg;
    let content = msg.content.trim();

    if (metadata.type === "new-conversation") {
      if (newConversation) {
        prompt.push({
          ...msg,
          prunable: false,
          content: `${beforeSystem}${newConversation}${afterSystem}`,
        });
      }
    } else if (metadata.type === "new-example-dialogue") {
      if (newExample) {
        prompt.push({
          ...msg,
          prunable: false,
          content: `${beforeSystem}${newExample}${afterSystem}`,
        });
      }
    } else if (metadata.type === "context") {
      prompt.push({
        ...msg,
        prunable: false,
        content: `${beforeSystem}${context}${content}${afterSystem}`,
      });
      if (contextResponse) {
        prompt.push({
          role: "assistant",
          metadata: { type: "context-response" },
          prunable: false,
          content: `${beforeAssistant}${contextResponse}${afterAssistant}`,
        });
      }
    } else if (metadata.type === "example-assistant") {
      const keepFirst =
        config.alwaysKeepFirstAssistantExample &&
        metadata.exampleAssistantMsgIndex === 0;
      prompt.push({
        ...msg,
        prunable: !(config.keepExampleMessagesInPrompt || keepFirst),
        content: `${beforeAssistant}${assistantName()}${content}${afterAssistant}`,
      });
    } else if (metadata.type === "example-user") {
      prompt.push({
        ...msg,
        prunable: !config.keepExampleMessagesInPrompt,
        content: `${beforeUser}${userName()}${content}${afterUser}`,
      });
    } else if (metadata.type === "other" || metadata.type === "jailbreak") {
      prompt.push({
        ...msg,
        prunable: false,
        content: `${beforeSystem}${content}${afterSystem}`,
      });
    } else if (metadata.type === "impersonation-prompt") {
      impersonationPromptFound = true;
    } else if (metadata.type === "assistant-msg") {
      prompt.push({
        ...msg,
        prunable: true,
        content: `${beforeAssistant}${assistantName()}${content}${afterAssistant}`,
      });
    } else if (metadata.type === "user-msg") {
      prompt.push({
        ...msg,
        prunable: true,
        content: `${beforeUser}${userName()}${content}${afterUser}`,
      });
    }
  }

  const last = getLastChatMessage(prompt);

  if (impersonationPromptFound || last?.role === "user" || silentMessage) {
    if (last?.role === "assistant" && silentMessage) {
      prompt.push({
        role: "user",
        metadata: { type: "silent-message" },
        prunable: false,
        content: `${beforeUser}${userName()}${silentMessage}${afterUser}`,
      });
    }

    if (impersonationPromptFound) {
      prompt.push({
        role: "system",
        metadata: { type: "impersonation-prompt" },
        prunable: false,
        content: `${beforeSystem}${impersonationPrompt}${afterSystem}`,
      });
    }

    prompt.push({
      role: impersonationPromptFound ? "user" : "assistant",
      metadata: { type: "reply-to-complete" },
      prunable: false,
      content: `${impersonationPromptFound ? beforeUser : beforeAssistant}${
        impersonationPromptFound
          ? userName(replyAttributes)
          : assistantName(replyAttributes)
      }${characterBias}`,
    });
  } else {
    const msg = popLastAssistantMessage(prompt);
    const end = msg.content.length - afterAssistant.length;
    msg.content = msg.content.substring(0, end);
    prompt.push(msg);
  }

  prompt.splice(prompt.length - 5, 0, {
    role: "system",
    metadata: { type: "superbig-injection-point" },
    prunable: true,
    content: "",
  });

  if (impersonationPromptFound) {
    generationConfig.max_new_tokens = config.impersonationMaxNewTokens;
  }

  return prompt;
};
