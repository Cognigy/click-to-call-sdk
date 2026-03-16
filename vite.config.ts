import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'node:path';
import compression from "vite-plugin-compression";
import { analyzer } from 'vite-bundle-analyzer'
import { readFileSync, existsSync } from 'node:fs';
import type { Plugin } from 'vite';

// Plugin to serve files from dist/ in dev mode
function serveDistPlugin(): Plugin {
	return {
		name: 'serve-dist',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (req.url?.startsWith('/dist/')) {
					const filePath = resolve(__dirname, req.url.slice(1));
					if (existsSync(filePath)) {
						const content = readFileSync(filePath);
						const ext = filePath.split('.').pop();
						const contentType = ext === 'js' ? 'application/javascript' :
							ext === 'mjs' ? 'application/javascript' :
								ext === 'map' ? 'application/json' :
									'text/plain';
						res.setHeader('Content-Type', contentType);
						res.end(content);
						return;
					}
				}
				next();
			});
		},
	};
}

export default defineConfig(({ mode }) => {
	const isProd = mode === 'production';
	const isDev = mode === 'development';

	return {
		plugins: [
			dts({
				insertTypesEntry: true,
				include: ['src/**/*'],
				exclude: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/__tests__/**/*'],
			}),
			...(isDev ? [serveDistPlugin()] : []),
			...(isProd ? [
				compression({ algorithm: "gzip" }),
				compression({ algorithm: "brotliCompress", ext: ".br" }),
				analyzer(),
			] : []),
		],
		build: {
			lib: {
				entry: resolve(__dirname, 'src/index.ts'),
				name: 'WebRTCSDK',
				formats: ['umd', 'cjs', 'es'],
				fileName: (format) => {
					if (format === 'es') return 'webRTCSDK.es.js';
					if (format === 'cjs') return 'webRTCSDK.cjs.js';
					return 'webRTCSDK.js';
				},
			},
			rollupOptions: {
				output: {
					exports: 'named',
				},
			},
			sourcemap: !isProd,
			minify: 'terser',
			target: 'es2020',
		},
		server: isDev ? {
			port: 3000,
			open: true,
		} : undefined,
		resolve: {
			alias: {
				'@': resolve(__dirname, 'src'),
			},
		},
		define: {
			__VERSION__: JSON.stringify(process.env.npm_package_version || '0.0.1'),
		},
	}
});
