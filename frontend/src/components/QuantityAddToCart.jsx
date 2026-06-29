import { useEffect, useRef, useState } from 'react'

export default function QuantityAddToCart({
  onAdd,
  buttonLabel = 'Add to Cart',
  min = 1,
  max = 99,
  onQuantityChange,
}) {
  const [quantity, setQuantity] = useState(1)
  const [inputValue, setInputValue] = useState('1')
  const onQuantityChangeRef = useRef(onQuantityChange)

  useEffect(() => {
    onQuantityChangeRef.current = onQuantityChange
  }, [onQuantityChange])

  useEffect(() => {
    if (typeof onQuantityChangeRef.current === 'function') {
      onQuantityChangeRef.current(quantity)
    }
  }, [quantity])

  function clampQuantity(value) {
    if (Number.isNaN(value)) return min
    return Math.max(min, Math.min(max, value))
  }

  function handleInputChange(event) {
    const nextValue = event.target.value
    setInputValue(nextValue)

    if (nextValue === '') return

    const parsedValue = Number(nextValue)
    if (!Number.isNaN(parsedValue)) {
      setQuantity(clampQuantity(parsedValue))
    }
  }

  function handleInputBlur() {
    const parsedValue = Number(inputValue)
    const clampedValue = clampQuantity(parsedValue)
    setQuantity(clampedValue)
    setInputValue(String(clampedValue))
  }

  function decreaseQuantity() {
    setQuantity((current) => {
      const nextValue = clampQuantity(current - 1)
      setInputValue(String(nextValue))
      return nextValue
    })
  }

  function increaseQuantity() {
    setQuantity((current) => {
      const nextValue = clampQuantity(current + 1)
      setInputValue(String(nextValue))
      return nextValue
    })
  }

  function handleAdd() {
    const parsedValue = Number(inputValue)
    const finalQuantity = clampQuantity(Number.isNaN(parsedValue) ? quantity : parsedValue)
    setQuantity(finalQuantity)
    setInputValue(String(finalQuantity))
    onAdd(finalQuantity)
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex w-full flex-col items-center gap-2 sm:flex-row sm:justify-center">
        <div className="inline-flex h-10 items-stretch overflow-hidden rounded-md border border-slate-300 bg-white">
          <button
            type="button"
            onClick={decreaseQuantity}
            className="flex h-10 w-9 items-center justify-center text-sm font-semibold text-slate-700 hover:bg-slate-100"
            aria-label="Decrease quantity"
          >
            -
          </button>

          <input
            type="number"
            min={min}
            max={max}
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            className="h-10 w-14 border-0 px-1 text-center text-sm font-semibold text-slate-900 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            aria-label="Quantity"
          />

          <button
            type="button"
            onClick={increaseQuantity}
            className="flex h-10 w-9 items-center justify-center text-sm font-semibold text-slate-700 hover:bg-slate-100"
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>

        <button
          type="button"
          onClick={handleAdd}
          className="inline-flex h-10 items-center justify-center rounded-md bg-[#123A7A] px-4 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-[#0f3168]"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  )
}
