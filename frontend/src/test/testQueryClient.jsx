import { QueryClientProvider } from '@tanstack/react-query'
import { createTestQueryClient } from './createTestQueryClient'

export function QueryProvider({ children, client = createTestQueryClient() }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
