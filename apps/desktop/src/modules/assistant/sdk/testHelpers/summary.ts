/** The model must distinguish a summary from a reply to the historical conversation. */
export const summaryResponse = (text: string) => `<conversation_summary>\n${text}\n</conversation_summary>`;
