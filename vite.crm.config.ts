import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Second app in this repo: the Ecolens Pipeline CRM lives under crm/.
// `--mode single` produces a self-contained crm/dist-single/index.html,
// which is what gets published as the shared claude.ai artifact.
export default defineConfig(({ mode }) => ({
  root: 'crm',
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    emptyOutDir: true,
  },
}))
