import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// host: true permite abrirlo desde el celular con la IP de tu PC (misma red wifi).
export default defineConfig({ plugins: [react()], server: { host: true, port: 5173 } });
