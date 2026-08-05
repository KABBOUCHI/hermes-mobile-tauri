export function sharedDraftNavigation(token: string) {
  return {
    name: 'chat',
    query: { shared: token },
  }
}
