const extensionObjectivePrompt =
  "Pause your roleplay. Determine if this task is completed:";

const findCharacterNames = ({ messages }) => {
  let assistant = "Bot";
  let user = "You";

  let msgIndex;
  let msg;
  let parts;
  let partsNewLineSplit;

  if (!parts && !partsNewLineSplit) {
    msgIndex = messages.length - 1;
    msg = messages[msgIndex];

    if (msg.role === "system") {
      if (
        msg.content.startsWith("IMPERSONATION_PROMPT") ||
        msg.content.startsWith(extensionObjectivePrompt)
      ) {
        msgIndex -= 1;
        msg = messages[msgIndex];
      }

      const content = msg.content.trim();
      const newLinePos = content.indexOf("\n");
      const firstLine =
        newLinePos === -1 ? content : content.substring(0, newLinePos).trim();

      let split = firstLine.split("\\n");
      if (split.length === 1) {
        split = firstLine.split("|");
      }
      if (split.length === 2) {
        parts = split;
      } else {
        split = content.split("\n");
        if (split.length === 2) {
          partsNewLineSplit = split;
        }
      }
    }
  }

  if (!parts && !partsNewLineSplit) {
    msgIndex = messages.findIndex((v) => v.role === "system");
    msg = messages[msgIndex];

    const content = msg.content.trim();
    const newLinePos = content.indexOf("\n");
    const firstLine =
      newLinePos === -1 ? content : content.substring(0, newLinePos).trim();

    const split = firstLine.split("|");
    if (split.length === 2) {
      parts = split;
    }
  }

  if (!parts && partsNewLineSplit) {
    parts = partsNewLineSplit;
  }

  if (parts) {
    assistant = parts[0].trim();
    user = parts[1].trim();

    const newLinePos = msg.content.indexOf("\n");
    msg.content =
      newLinePos === -1 || partsNewLineSplit
        ? ""
        : msg.content.substring(newLinePos + 1).trimStart();

    if (msg.content.length === 0) {
      messages.splice(msgIndex, 1);
    }
  }

  return { user, assistant };
};

const fixExampleMessages = ({ user, assistant, messages }) => {
  let fixedMessages = [];

  for (const { role, content, name } of messages) {
    if (
      role === "system" &&
      (name === "example_assistant" || name === "example_user")
    ) {
      let split;
      if (name === "example_assistant") {
        split = content.split(`\n${assistant}:`);
      } else {
        split = content.split(`\n${user}:`);
      }
      fixedMessages.push({
        role,
        name,
        content: split.map((v) => v.trim()).join("\n"),
      });
    } else {
      fixedMessages.push({ role, content, name });
    }
  }

  return fixedMessages;
};

const parseImpersonationPrompt = (content) =>
  content.replace("IMPERSONATION_PROMPT", "").trimStart();

const addMetadataToMessages = (messages, config) => {
  let mainPromptFound = false;
  let msgCount = 0;

  let newChatCount = 0;

  let exampleMsgCount = 0;
  let exampleUserCount = 0;
  let exampleAssistantCount = 0;

  let chatMsgCount = 0;
  let userMsgCount = 0;
  let assistantMsgCount = 0;

  let otherSystemMsgCount = 0;

  const updatedConfig = {
    jailbreak: config.jailbreak,
    impersonationPrompt: config.impersonationPrompt,
  };

  // TODO: support group chats
  // TODO: split personality
  // TODO: split scenario

  for (const msg of messages) {
    const { content, role, name } = msg;
    const metadata = { index: msgCount };
    if (role === "system") {
      if (content === "[Start a new chat]") {
        metadata.type = "new-example-dialogue";
        metadata.chatIndex = newChatCount;
        newChatCount += 1;
      } else if (!mainPromptFound) {
        mainPromptFound = true;
        metadata.type = "context";
      } else if (content.startsWith("IMPERSONATION_PROMPT")) {
        metadata.type = "impersonation-prompt";
        const tmp = parseImpersonationPrompt(content);
        if (tmp) {
          updatedConfig.impersonationPrompt = tmp;
        }
      } else if (content.startsWith(extensionObjectivePrompt)) {
        metadata.type = "extension-prompt";
      } else if (name === "example_assistant") {
        metadata.type = "example-assistant";
        metadata.chatIndex = newChatCount - 1;
        metadata.exampleMsgIndex = exampleMsgCount;
        metadata.exampleAssistantMsgIndex = exampleAssistantCount;
        exampleMsgCount += 1;
        exampleAssistantCount += 1;
      } else if (name === "example_user") {
        metadata.type = "example-user";
        metadata.chatIndex = newChatCount - 1;
        metadata.exampleMsgIndex = exampleUserCount;
        metadata.exampleUserMsgIndex = exampleUserCount;
        exampleMsgCount += 1;
        exampleUserCount += 1;
      } else {
        if (msgCount === messages.length - 1) {
          metadata.type = "jailbreak";
          if (content) {
            updatedConfig.jailbreak = content;
          }
        } else {
          metadata.type = "other";
          metadata.otherIndex = otherSystemMsgCount;
        }
        otherSystemMsgCount += 1;
      }
    } else if (role === "assistant") {
      metadata.type = "assistant-msg";
      metadata.chatMsgIndex = chatMsgCount;
      metadata.assistantMsgIndex = assistantMsgCount;
      chatMsgCount += 1;
      assistantMsgCount += 1;
    } else if (role === "user") {
      metadata.type = "user-msg";
      metadata.chatMsgIndex = chatMsgCount;
      metadata.userMsgIndex = userMsgCount;
      chatMsgCount += 1;
      userMsgCount += 1;
    }
    msg.metadata = metadata;
    msgCount++;
  }

  updatedConfig.chatMetadata = {
    messages: msgCount,
    exampleChats: newChatCount - 1,
    exampleUserMessages: exampleUserCount,
    exampleAssistantMessages: exampleAssistantCount,
    userMessages: userMsgCount,
    assistantMessages: assistantMsgCount,
    chatMessages: chatMsgCount,
  };

  const msg = messages.findLast(
    (v) => v.metadata.type === "new-example-dialogue"
  );
  if (msg) {
    msg.metadata.type = "new-conversation";
    delete msg.metadata.chatIndex;
  }

  return updatedConfig;
};

export const parseMessages = ({ messages, config }) => {
  let updatedConfig = {};

  // TODO: translate from agnai to tavern's format

  const { user, assistant } = findCharacterNames({ messages });
  updatedConfig.user = user;
  updatedConfig.assistant = assistant;
  console.log({ user, assistant });

  const updatedMessages = fixExampleMessages({
    user,
    assistant,
    messages,
  });

  const tmpConfig = addMetadataToMessages(updatedMessages, config);

  updatedConfig = { ...updatedConfig, ...tmpConfig }; // TODO: merge

  return { updatedMessages, updatedConfig };
};
