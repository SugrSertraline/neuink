type Request = { root: string; conversationId: string };
let pending: Request | null = null;
const listeners = new Set<(request: Request) => void>();

/** Also works when the assistant is currently unmounted behind another left-side tool. */
export function requestOpenAssistantConversation(root: string, conversationId: string) {
  const request = { root, conversationId };
  pending = request;
  for (const listener of listeners) listener(request);
}

export function subscribeAssistantConversationNavigation(root: string, listener: (request: Request) => void) {
  const receive = (request: Request) => {
    if (request.root !== root) return;
    if (pending === request) pending = null;
    listener(request);
  };
  listeners.add(receive);
  if (pending?.root === root) receive(pending);
  return () => { listeners.delete(receive); };
}
