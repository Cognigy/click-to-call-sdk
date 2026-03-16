import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
	test: {
		testTimeout: 20000, // Increase from 10000 to 20000
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/__tests__/setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: [
				'node_modules/',
				'src/__tests__/',
				'src/**/*.test.ts',
				'src/**/*.spec.ts',
				'dist/',
				'coverage/',
				'*.config.ts',
				'src/types/',
			],
			thresholds: {
				global: {
					branches: 80,
					functions: 80,
					lines: 80,
					statements: 80,
				},
			},
		},
		include: ['src/**/*.{test,spec}.ts'],
		exclude: ['node_modules/', 'dist/', 'coverage/'],
	},
	resolve: {
		alias: {
			'@': resolve(__dirname, 'src'),
		},
	},
});
