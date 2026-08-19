import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const distDirectory = new URL('../dist/', import.meta.url)
const assetsDirectory = new URL('../dist/assets/', import.meta.url)
const limits = {
  entryJavaScriptBytes: 250 * 1024,
  largestJavaScriptChunkBytes: 300 * 1024,
  criticalImageBytes: 250 * 1024,
}

async function fileSize(url) {
  const file = await stat(url)
  return file.size
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`
}

const assetNames = await readdir(assetsDirectory)
const javascriptAssets = assetNames.filter((name) => name.endsWith('.js'))
const entryAsset = javascriptAssets.find((name) => /^index-[^/]+\.js$/.test(name))
if (!entryAsset) {
  throw new Error('Could not find the built JavaScript entry chunk in dist/assets')
}

const javascriptSizes = await Promise.all(
  javascriptAssets.map(async (name) => ({
    name,
    bytes: await fileSize(join(assetsDirectory.pathname, name)),
  })),
)
const entrySize = javascriptSizes.find(({ name }) => name === entryAsset).bytes
const largestChunk = javascriptSizes.reduce((largest, current) => (
  current.bytes > largest.bytes ? current : largest
))

const criticalImages = ['logo-hero.png', 'manley-lifting-hero-bg.jpg']
const criticalImageSizes = await Promise.all(
  criticalImages.map(async (name) => ({
    name,
    bytes: await fileSize(new URL(`../dist/${name}`, import.meta.url)),
  })),
)
const criticalImageTotal = criticalImageSizes.reduce((total, image) => total + image.bytes, 0)

const failures = []
if (entrySize > limits.entryJavaScriptBytes) {
  failures.push(`entry JavaScript is ${formatBytes(entrySize)} (limit ${formatBytes(limits.entryJavaScriptBytes)})`)
}
if (largestChunk.bytes > limits.largestJavaScriptChunkBytes) {
  failures.push(`largest JavaScript chunk is ${formatBytes(largestChunk.bytes)}: ${largestChunk.name} (limit ${formatBytes(limits.largestJavaScriptChunkBytes)})`)
}
if (criticalImageTotal > limits.criticalImageBytes) {
  failures.push(`critical images total ${formatBytes(criticalImageTotal)} (limit ${formatBytes(limits.criticalImageBytes)})`)
}

console.log(`Entry JavaScript: ${formatBytes(entrySize)}`)
console.log(`Largest JavaScript chunk: ${formatBytes(largestChunk.bytes)} (${largestChunk.name})`)
console.log(`Critical images: ${formatBytes(criticalImageTotal)} (${criticalImageSizes.map(({ name }) => name).join(', ')})`)

if (failures.length) {
  console.error('Performance budget failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log('Performance budget passed.')
}
