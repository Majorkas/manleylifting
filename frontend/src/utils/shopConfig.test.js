import { beforeEach, describe, expect, it } from 'vitest'
import { CART_STORAGE_KEY, loadCartItems } from './shopConfig'

describe('shopConfig cart normalization', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('clamps and filters malformed cart data from storage', () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify([
        {
          handle: 'chain-block',
          title: 'Chain Block',
          variantId: 'variant-1',
          price: '12.50',
          currency: 'EUR',
          quantity: '4',
        },
        {
          handle: 'rope-sling',
          title: 'Rope Sling',
          variantId: 'variant-2',
          price: '-1',
          currency: 'EUR',
          quantity: '0',
        },
        {
          handle: 'bad-item',
          title: 'Bad Item',
          variantId: '',
          price: 'NaN',
          currency: 'EUR',
          quantity: '2',
        },
        {
          handle: 'heavy-duty',
          title: 'Heavy Duty',
          variantId: 'variant-3',
          price: '5',
          currency: 'EUR',
          quantity: '120',
        },
        'not-an-object',
      ]),
    )

    expect(loadCartItems()).toEqual([
      {
        handle: 'chain-block',
        title: 'Chain Block',
        variantId: 'variant-1',
        price: 12.5,
        currency: 'EUR',
        imageUrl: '',
        quantity: 4,
      },
      {
        handle: 'heavy-duty',
        title: 'Heavy Duty',
        variantId: 'variant-3',
        price: 5,
        currency: 'EUR',
        imageUrl: '',
        quantity: 99,
      },
    ])
  })
})
