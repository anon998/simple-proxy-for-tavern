import {
  addStoppingStrings,
  getLastChatMessage,
  popLastAssistantMessage,
  popLastChatMessages,
  replaceTemplates,
} from "../src/utils.mjs";

export default ({ user, assistant, messages, config, generationConfig }) => {
  addStoppingStrings(config, ["\nLEAD:", "\nASSOCIATE:"]);

  const systemPrompt =
    "A transcript of a roleplay between two players, LEAD and ASSOCIATE. LEAD sets up a scenario and the characters, from which ASSOCIATE then assumes a character role and continues the story for that role in response to description given by LEAD. The story and characters are developed by exchange of detailed event descriptions and character dialogs, successively given by both LEAD and ASSOCIATE.";
  const newConversation = "LEAD: Let's start a new roleplay.";
  const newExample = "LEAD: Here are some old roleplays that we did before.";
  const context = `LEAD: I'm roleplaying as ${user} and you're roleplaying as ${assistant}. Here's the context for this roleplay:\n`;
  const contextResponse = `Okay. I will take that info into account to roleplay as ${assistant}.`;
  const characterBias = replaceTemplates(config.characterBias, config);
  const impersonationPrompt = replaceTemplates(
    config.impersonationPrompt,
    config
  );
  const silentMessage = replaceTemplates(config.silentMessage, config);

  let impersonationPromptFound = false;

  const userName = () => ``;
  const assistantName = () => ``;

  let beforeSystem = "\n\n";
  let afterSystem = "\n";
  let beforeUser = "\n\nLEAD: ";
  let afterUser = "\n";
  let beforeAssistant = "\n\nASSOCIATE: ";
  let afterAssistant = "</s>";

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
  const lastMessages = popLastChatMessages(prompt, 2);

  prompt.push({
    role: "system",
    metadata: { type: "superbig-injection-point" },
    prunable: true,
    content: "",
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

    prompt.push({
      role: impersonationPromptFound ? "user" : "assistant",
      metadata: { type: "reply-to-complete" },
      prunable: false,
      content: `${impersonationPromptFound ? beforeUser : beforeAssistant}${
        impersonationPromptFound ? userName() : assistantName()
      }${characterBias}`,
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

  return prompt;
};
