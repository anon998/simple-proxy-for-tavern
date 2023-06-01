import {
  getLastChatMessage,
  popLastAssistantMessage,
  popLastChatMessages,
  replaceTemplates,
} from "../src/utils.mjs";

const getNameString = ({ name, isExample } = {}) => {
  let props = [];
  if (isExample) {
    props.push("EXAMPLE");
  }
  return `#### ${name}${props.length ? ` (${props.join(", ")})` : ""}:\n`;
};

export default ({ user, assistant, messages, config, generationConfig }) => {
  const systemPrompt = "";
  const newConversation = "### New Roleplay:";
  const newExample = newConversation;
  const context = "### Input:\n";
  const contextResponse = `### Response:
(OOC) Understood. I will take this info into account for the roleplay. (end OOC)`;
  const characterBias = replaceTemplates(config.characterBias, config);
  const impersonationPrompt = replaceTemplates(
    config.impersonationPrompt,
    config
  );
  const silentMessage = replaceTemplates(config.silentMessage, config);

  let impersonationPromptFound = false;
  let extensionPrompt = null;

  const userName = (args = {}) => getNameString({ ...args, name: user });
  const assistantName = (args = {}) =>
    getNameString({ ...args, name: assistant });

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
      const keepFirst =
        config.alwaysKeepFirstAssistantExample &&
        metadata.exampleAssistantMsgIndex === 0;
      prompt.push({
        ...msg,
        prunable: !(config.keepExampleMessagesInPrompt || keepFirst),
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
    } else if (metadata.type === "extension-prompt") {
      extensionPrompt = {
        ...msg,
        prunable: false,
        content: `${beforeSystem}${content}${afterSystem}`,
      };
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

  prompt.push({
    role: "system",
    metadata: { type: "superbig-injection-point" },
    prunable: true,
    content: "",
  });

  prompt.push({
    role: "system",
    metadata: { type: "reply-instruction" },
    prunable: false,
    content: `${beforeSystem}${`### Instruction:
Write a continuation for this never-ending roleplay between ${assistant} and ${user}. Use the following rules.
### Input:
- It follows the EXAMPLE dialogue style.
- It develops the plot SLOWLY.
- It's always IN CHARACTER.
### Response:
(OOC) Understood. Following those rules and ${you}'s description above, the most descriptive and creative continuation for this roleplay is this: (end OOC)`}${afterSystem}`,
  });

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
    const length = impersonationPromptFound ? "1 paragraph" : "2 paragraphs";
    prompt.push({
      role: impersonationPromptFound ? "user" : "assistant",
      metadata: { type: "reply-to-complete" },
      prunable: false,
      content: `${before}#### ${you} (${length}, natural, slow progression, in character):\n${characterBias}`,
    });
  } else {
    const msg = popLastAssistantMessage(prompt);
    const end = msg.content.length - afterAssistant.length;
    msg.content = msg.content.substring(0, end);
    prompt.push(msg);
  }

  if (impersonationPromptFound) {
    generationConfig.max_new_tokens = config.impersonationMaxNewTokens;
  }

  if (extensionPrompt) {
    prompt.push(extensionPrompt);
  }

  return prompt;
};
