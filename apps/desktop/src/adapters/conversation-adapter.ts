export interface ConversationAdapter {
  sendMessage(text: string, signal?: AbortSignal): Promise<void>;
  waitForLatestResponseComplete(signal?: AbortSignal): Promise<void>;
  copyLatestReply(signal?: AbortSignal): Promise<string>;
}
