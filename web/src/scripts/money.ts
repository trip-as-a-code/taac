// Money on screen: the viewer's display currency (remembered on this device)
// and ECB rates — from the build, refreshed once per session through the
// worker. Booked costs carry what was actually charged; everything else is
// converted at today's rate and marked as an estimate.

import type { Rates } from '@taac/core'

const EVENT = 'taac:money'
const CURRENCY_KEY = 'taac:currency'
const RATES_KEY = 'taac:rates'
const WHOLE = new Set(['JPY', 'KRW', 'VND', 'ISK', 'HUF', 'CLP', 'IDR'])

let rates: Rates | null = null
let display = ''
let refreshing = false

export interface Priced {
  amount: number
  currency: string
  charged?: { amount: number; currency: string }
}

/** Reads build-time rates and the trip's default currency from the page. */
export function initMoney(): void {
  const raw = document.getElementById('taac-rates')?.textContent
  const root = document.querySelector<HTMLElement>('[data-currency-default]')
  const cached = read<Rates>(RATES_KEY, sessionStorage)
  const built = raw ? (JSON.parse(raw) as Rates | null) : null
  rates = cached && (!built || cached.date >= built.date) ? cached : built
  display = read<string>(CURRENCY_KEY, localStorage) ?? root?.dataset.currencyDefault ?? 'EUR'
  if (!refreshing && !cached) void refresh()
}

export function displayCurrency(): string {
  return display
}

export function ratesDate(): string | undefined {
  return rates?.date
}

export function setDisplayCurrency(code: string): void {
  display = code
  write(CURRENCY_KEY, code, localStorage)
  document.dispatchEvent(new CustomEvent(EVENT))
}

export function onMoney(listener: () => void): () => void {
  document.addEventListener(EVENT, listener)
  return () => document.removeEventListener(EVENT, listener)
}

export function knownCurrencies(): string[] {
  return rates ? Object.keys(rates.rates).sort() : []
}

/** `amount` of `from` in `to`, or null without a rate. */
export function convert(amount: number, from: string, to: string = display): number | null {
  return convertWith(rates, amount, from, to)
}

function convertWith(using: Rates | null, amount: number, from: string, to: string): number | null {
  if (from === to) return amount
  const a = using?.rates[from]
  const b = using?.rates[to]
  return a && b ? (amount / a) * b : null
}

/**
 * A price in the display currency. Exact when it is already in that currency
 * (charged or quoted), converted otherwise.
 */
export function value(priced: Priced, to: string = display): { amount: number; exact: boolean } | null {
  return valueWith(rates, priced, to)
}

function valueWith(using: Rates | null, priced: Priced, to: string): { amount: number; exact: boolean } | null {
  if (priced.charged?.currency === to) return { amount: priced.charged.amount, exact: true }
  if (priced.currency === to && !priced.charged) return { amount: priced.amount, exact: true }
  const source = priced.charged ?? priced
  const amount = convertWith(using, source.amount, source.currency, to)
  return amount === null ? null : { amount, exact: false }
}

export function format(amount: number, currency: string = display, options: Intl.NumberFormatOptions = {}): string {
  return formatIn(document.documentElement.lang, amount, currency, options)
}

function formatIn(lang: string, amount: number, currency: string, options: Intl.NumberFormatOptions = {}): string {
  const whole = WHOLE.has(currency) || options.maximumFractionDigits === 0
  return new Intl.NumberFormat(lang, {
    style: 'currency',
    currency,
    maximumFractionDigits: whole ? 0 : 2,
    minimumFractionDigits: whole || amount % 1 === 0 ? 0 : 2,
  }).format(amount)
}

/**
 * How a price reads in `to` at `using` rates — `≈` when converted — or null
 * without a rate. Pure: the build pre-renders the very text this script
 * would show, so nothing changes on load.
 */
export function priceText(priced: Priced, to: string, using: Rates | null, lang: string): string | null {
  const shown = valueWith(using, priced, to)
  return shown && `${shown.exact ? '' : '≈ '}${formatIn(lang, shown.amount, to)}`
}

/**
 * Fills every `[data-money]` (attributes: amount, currency, optional
 * charged-amount / charged-currency) with its display-currency amount. The
 * server-rendered original stays when there is no rate.
 */
export function renderMoney(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-money]')) {
    const original = el.dataset.original ?? el.textContent ?? ''
    el.dataset.original = original
    const priced: Priced = {
      amount: Number(el.dataset.amount),
      currency: el.dataset.currency!,
      charged: el.dataset.chargedCurrency
        ? { amount: Number(el.dataset.chargedAmount), currency: el.dataset.chargedCurrency }
        : undefined,
    }
    const text = priceText(priced, display, rates, document.documentElement.lang)
    if (!text) {
      el.textContent = original
      el.removeAttribute('title')
      continue
    }
    el.textContent = text
    el.title = text.startsWith('≈') ? original : ''
  }
}

/** Today's ECB rates through the worker's cached proxy; quietly skipped without it. */
async function refresh(): Promise<void> {
  refreshing = true
  try {
    const quotes = Object.keys(rates?.rates ?? {})
      .filter((c) => c !== 'EUR')
      .join(',')
    if (!quotes) return
    const response = await fetch(`/api/fx?base=EUR&quotes=${quotes}`)
    if (!response.ok) return
    const live = (await response.json()) as { date: string; rates: Record<string, number> }
    rates = { date: live.date, rates: { EUR: 1, ...live.rates } }
    write(RATES_KEY, rates, sessionStorage)
    document.dispatchEvent(new CustomEvent(EVENT))
  } catch {
    // Plain dev server or offline: the build's rates stand.
  } finally {
    refreshing = false
  }
}

function read<T>(key: string, storage: Storage): T | undefined {
  try {
    const raw = storage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}

function write(key: string, value: unknown, storage: Storage): void {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // Remembering is a convenience.
  }
}
