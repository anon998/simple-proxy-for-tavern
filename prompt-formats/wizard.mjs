import {
  getLastChatMessage,
  popLastAssistantMessage,
  popLastChatMessages,
  replaceTemplates,
} from "../src/utils.mjs";

const getNameString = ({ name, isExample, attr } = {}) =>
  `#### ${name}${isExample ? `'s example dialogue` : ""}${attr || ""}:\n`;

export default ({ user, assistant, messages, config, generationConfig }) => {
  const systemPrompt = `You're taking on the role of "${assistant}" in this never-ending roleplay with "${user}".`;
  const newConversation = "";
  const newExample = newConversation;
  const context = "Here's the context for this roleplay:\n";
  const contextResponse = `### Response:
(OOC) Understood. I will take this info into account to roleplay as ${assistant}. (end OOC)`;
  const replyAttributes = (impersonation) =>
    impersonation ? "" : " (2-4 paragraphs)";
  const characterBias = replaceTemplates(config.characterBias, config);
  const impersonationPrompt = replaceTemplates(
    config.impersonationPrompt,
    config
  );
  const silentMessage = replaceTemplates(config.silentMessage, config);

  let impersonationPromptFound = false;

  const userName = (args = {}) => getNameString({ ...args, name: user });
  const assistantName = (args = {}) =>
    getNameString({ ...args, name: assistant });

  const beforeSystem = "\n\n";
  const afterSystem = "\n";
  const beforeUser = "\n\n";
  const afterUser = "\n";
  const beforeAssistant = "\n\n";
  const afterAssistant = "\n";

  const addReplyInstruction = true;
  const replyInstruction = ({
    you,
    other,
  }) => `${beforeSystem}Write a continuation for this never-ending roleplay. Develop the plot slowly and always stay in character. Avoid taking control of ${other}'s actions or including OOC messages in ${you}'s replies.
### Response:
(OOC) Understood. Following those instructions and ${you}'s description above, the most descriptive and creative continuation for this roleplay is this: (end OOC)${afterSystem}`;

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
      if (newExample && metadata.chatIndex === 0) {
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
      prompt.push({
        ...msg,
        prunable: !(
          config.keepExampleMessagesInPrompt ||
          metadata.exampleAssistantMsgIndex === 0
        ),
        content: `${beforeAssistant}${assistantName({
          isExample: true,
        })}${content}${afterAssistant}`,
      });
    } else if (metadata.type === "example-user") {
      prompt.push({
        ...msg,
        prunable: !config.keepExampleMessagesInPrompt,
        content: `${beforeUser}${userName({
          isExample: true,
        })}${content}${afterUser}`,
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
  const lastMessages = popLastChatMessages(prompt, 2);

  const you = impersonationPromptFound ? user : assistant;
  const other = impersonationPromptFound ? assistant : user;

  if (addReplyInstruction) {
    prompt.push({
      role: "system",
      metadata: { type: "reply-instruction" },
      prunable: false,
      content: replyInstruction({ you, other }),
    });
  }

  for (const msg of lastMessages) {
    prompt.push(msg);
  }

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

    const before = impersonationPromptFound ? beforeUser : beforeAssistant;
    const name = impersonationPromptFound ? userName : assistantName;
    const role = impersonationPromptFound ? "user" : "assistant";
    const attr = replyAttributes(impersonationPromptFound);
    prompt.push({
      role,
      metadata: { type: "reply-to-complete" },
      prunable: false,
      content: `${before}${name({ attr })}${characterBias}`,
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
