// @ts-check

/**
 * One left/right decision per peg row.
 *
 * Each peg is an independent Bernoulli trial, so the number of rights is
 * exactly Binomial(rows, p) — which is the whole point: the pile the balls
 * build is provably the binomial distribution, not an approximation of it,
 * and the theoretical curve drawn over it will match.
 *
 * @param {number} rows number of peg rows
 * @param {number} p probability of going right at each peg
 * @param {() => number} rng returns [0, 1); injected so tests are deterministic
 * @returns {(0|1)[]} 1 = right, 0 = left
 */
export function walkSteps(rows, p, rng) {
  const steps = /** @type {(0|1)[]} */ ([])
  for (let i = 0; i < rows; i++) steps.push(rng() < p ? 1 : 0)
  return steps
}

/**
 * @param {(0|1)[]} steps
 * @returns {number} destination bin — the number of rights taken
 */
export function binOf(steps) {
  let n = 0
  for (const s of steps) n += s
  return n
}

/**
 * Binomial probability mass function.
 *
 * Built by the multiplicative recurrence P(k+1) = P(k) · (n-k)/(k+1) · p/(1-p)
 * rather than by computing factorials, which overflow well before they need to
 * and lose precision long before that. Degenerate p (0 or 1) is handled
 * separately because the recurrence divides by (1 - p).
 *
 * @param {number} rows
 * @param {number} p
 * @returns {number[]} length rows + 1, summing to 1
 */
export function binomialPmf(rows, p) {
  const out = new Array(rows + 1).fill(0)
  if (p <= 0) { out[0] = 1; return out }
  if (p >= 1) { out[rows] = 1; return out }

  let term = (1 - p) ** rows            // P(0)
  out[0] = term
  const ratio = p / (1 - p)
  for (let k = 0; k < rows; k++) {
    term = term * ((rows - k) / (k + 1)) * ratio
    out[k + 1] = term
  }
  return out
}

/**
 * Closed-form mean and standard deviation of Binomial(rows, p).
 * @param {number} rows
 * @param {number} p
 * @returns {{ mean: number, sd: number }}
 */
export function momentsFor(rows, p) {
  return { mean: rows * p, sd: Math.sqrt(rows * p * (1 - p)) }
}

/**
 * Statistics of an observed histogram, so the sample can be compared against
 * momentsFor() live. Uses the population standard deviation, matching the
 * closed form rather than the sample estimator.
 *
 * @param {number[]} counts counts[i] = balls that landed in bin i
 * @returns {{ n: number, mean: number, sd: number }}
 */
export function sampleStats(counts) {
  let n = 0, sum = 0
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i] ?? 0
    n += c
    sum += i * c
  }
  if (n === 0) return { n: 0, mean: 0, sd: 0 }

  const mean = sum / n
  let variance = 0
  for (let i = 0; i < counts.length; i++) {
    variance += (counts[i] ?? 0) * (i - mean) ** 2
  }
  return { n, mean, sd: Math.sqrt(variance / n) }
}
