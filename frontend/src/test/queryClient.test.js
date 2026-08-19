import { describe, expect, it } from 'vitest'
import { queryClient } from '../queryClient'
import { queryKeys } from '../queryKeys'

describe('TanStack Query foundation', () => {
  it('creates stable distinct keys for catalog and detail resources', () => {
    expect(queryKeys.catalog()).toEqual(['catalog'])
    expect(queryKeys.product('chain-block')).toEqual(['catalog', 'product', 'chain-block'])
    expect(queryKeys.product('chain-block')).toEqual(queryKeys.product('chain-block'))
    expect(queryKeys.product('other')).not.toEqual(queryKeys.product('chain-block'))
    expect(queryKeys.order(0)).not.toEqual(queryKeys.order(undefined))
  })

  it('configures finite query retries and disables mutation retries', () => {
    const retry = queryClient.getDefaultOptions().queries.retry
    expect(retry(0, { status: 401 })).toBe(false)
    expect(retry(0, { status: 500 })).toBe(true)
    expect(retry(1, { status: 500 })).toBe(false)
    expect(queryClient.getDefaultOptions().mutations.retry).toBe(0)
  })
})