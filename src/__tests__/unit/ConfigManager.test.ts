/**
 * Unit tests for ConfigManager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigManager } from '../../ConfigManager.js';
import { mockEndpointConfig, mockFetchResponses } from '../mocks/fixtures.js';

describe('ConfigManager', () => {
	let configManager: ConfigManager;
	const mockEndpointUrl = 'https://test-api.example.com/config';
	const mockUserId = 'test-user-123';

	beforeEach(() => {
		configManager = new ConfigManager(mockEndpointUrl, mockUserId);
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('constructor', () => {
		it('should create ConfigManager with endpoint URL and token', () => {
			expect(configManager).toBeInstanceOf(ConfigManager);
			expect(configManager.getConfig()).toBeNull();
		});
	});

	describe('fetchConfig', () => {
		it('config GET sends no Content-Type header (simple CORS request)', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);

			await configManager.fetchConfig();

			const callArgs = (fetch as any).mock.calls[0];
			const init = callArgs[1];
			if (init?.headers) {
				expect(init.headers['Content-Type']).toBeUndefined();
				expect(init.headers['content-type']).toBeUndefined();
			}
		});

		it('should fetch configuration successfully', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);

			const config = await configManager.fetchConfig();

			expect(fetch).toHaveBeenCalledWith(mockEndpointUrl, {
				method: 'GET',
			});
			expect(config).toEqual(mockEndpointConfig);
		});

		it('should return cached config on subsequent calls', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);

			const config1 = await configManager.fetchConfig();
			const config2 = await configManager.fetchConfig();

			expect(fetch).toHaveBeenCalledTimes(1);
			expect(config1).toBe(config2);
		});

		it('should handle HTTP error responses', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.unauthorized);

			await expect(configManager.fetchConfig()).rejects.toThrow(
				'Failed to fetch config: 401 Unauthorized'
			);
		});

		it('should handle network errors', async () => {
			global.fetch = vi.fn().mockRejectedValue(new Error('Network Error'));

			await expect(configManager.fetchConfig()).rejects.toThrow(
				'Configuration fetch failed: Network Error'
			);
		});

		it('should handle timeout', async () => {
			global.fetch = vi.fn().mockImplementation(() => mockFetchResponses.timeout());

			await expect(configManager.fetchConfig()).rejects.toThrow(
				'Configuration fetch failed: Operation timed out after 10000ms'
			);
		});

		it('resolves configs that fail SIP validation (validation moved to assertCallable)', async () => {
			const invalidResponse = {
				ok: true,
				status: 200,
				json: () => Promise.resolve({ invalid: 'config' }),
			};
			global.fetch = vi.fn().mockResolvedValue(invalidResponse);

			await expect(configManager.fetchConfig()).resolves.toEqual({ invalid: 'config' });
		});

		it('shares one in-flight fetch between concurrent calls', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);

			const [config1, config2] = await Promise.all([
				configManager.fetchConfig(),
				configManager.fetchConfig(),
			]);

			expect(fetch).toHaveBeenCalledTimes(1);
			expect(config1).toBe(config2);
		});

		it('does not cache a failed fetch', async () => {
			global.fetch = vi
				.fn()
				.mockResolvedValueOnce(mockFetchResponses.unauthorized)
				.mockResolvedValueOnce(mockFetchResponses.success);

			await expect(configManager.fetchConfig()).rejects.toThrow('401 Unauthorized');
			await expect(configManager.fetchConfig()).resolves.toEqual(mockEndpointConfig);
			expect(fetch).toHaveBeenCalledTimes(2);
		});

		it('generates a userId when none was provided', async () => {
			const anonymous = new ConfigManager(mockEndpointUrl);
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);

			await anonymous.fetchConfig();

			expect(anonymous.getSipCredentials().userId).toMatch(/^webrtc-sdk-test-webrtc-endpoint-/);
		});
	});

	describe('assertCallable', () => {
		it('throws when the loaded config fails SIP validation', async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ invalid: 'config' }),
			});
			await configManager.fetchConfig();

			expect(() => configManager.assertCallable()).toThrow(
				'Invalid endpoint configuration received'
			);
		});

		it('throws when no config is loaded', () => {
			expect(() => configManager.assertCallable()).toThrow('Invalid endpoint configuration received');
		});

		it('does not throw for a valid config', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);
			await configManager.fetchConfig();

			expect(() => configManager.assertCallable()).not.toThrow();
		});
	});

	describe('setUserId', () => {
		it('overrides a constructor-provided userId', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);
			await configManager.fetchConfig();

			configManager.setUserId('webrtc-x');

			expect(configManager.getSipCredentials().userId).toBe('webrtc-x');
			expect(configManager.getSipCredentials().fullUsername).toBe('webrtc-x@sip.example.com');
		});

		it('overrides a generated userId and survives later fetches', async () => {
			const anonymous = new ConfigManager(mockEndpointUrl);
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);
			await anonymous.fetchConfig();

			anonymous.setUserId('webrtc-x');
			anonymous.clearConfig();
			await anonymous.fetchConfig();

			expect(anonymous.getSipCredentials().userId).toBe('webrtc-x');
		});

		it('is not overwritten by a fetch that finishes afterwards', async () => {
			const anonymous = new ConfigManager(mockEndpointUrl);
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);

			const pending = anonymous.fetchConfig();
			anonymous.setUserId('webrtc-x');
			await pending;

			expect(anonymous.getSipCredentials().userId).toBe('webrtc-x');
		});

		it('rejects an empty id', () => {
			expect(() => configManager.setUserId('')).toThrow('userId must be a non-empty string');
		});
	});

	describe('getConfig', () => {
		it('should return null when no config is loaded', () => {
			expect(configManager.getConfig()).toBeNull();
		});

		it('should return config after fetching', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);

			await configManager.fetchConfig();
			expect(configManager.getConfig()).toEqual(mockEndpointConfig);
		});
	});


	describe('getApplicationSid', () => {
		it('should return application SID from config', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);
			await configManager.fetchConfig();

			const appSid = configManager.getApplicationSid();
			expect(appSid).toBe('00000000-0000-0000-0000-000000000002');
		});

		it('should throw error when config is not loaded', () => {
			expect(() => configManager.getApplicationSid()).toThrow(
				'Configuration not loaded'
			);
		});
	});

	describe('getSipCredentials', () => {
		it('includes organisationId/projectId/endpointId from the config', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);
			await configManager.fetchConfig();

			const credentials = configManager.getSipCredentials();
			expect(credentials.organisationId).toBe('test-org-id');
			expect(credentials.projectId).toBe('test-project-id');
			expect(credentials.endpointId).toBeUndefined();
		});
	});

	describe('getCallTarget', () => {
		it('dials app-<applicationSid> when the config has no endpointId (legacy endpoint)', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);
			await configManager.fetchConfig();

			expect(configManager.getCallTarget()).toBe('app-00000000-0000-0000-0000-000000000002');
		});

		it('dials the bare endpointId once organisationId/projectId/endpointId are all declared', async () => {
			const runtimeConfig = {
				...mockEndpointConfig,
				endpointSettings: {
					...mockEndpointConfig.endpointSettings,
					endpointId: 'endpoint-1',
				},
			};
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => Promise.resolve(runtimeConfig),
			});
			await configManager.fetchConfig();

			expect(configManager.getCallTarget()).toBe('endpoint-1');
		});

		it('throws when config is not loaded', () => {
			expect(() => configManager.getCallTarget()).toThrow('Configuration not loaded');
		});
	});

	describe('isActive', () => {
		it('should return true when widget is active', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);
			await configManager.fetchConfig();

			expect(configManager.isActive()).toBe(true);
		});

		it('should return false when no config is loaded', () => {
			expect(configManager.isActive()).toBe(false);
		});

		it('should return false when widget is inactive', async () => {
			const inactiveConfig = {
				...mockEndpointConfig,
				endpointSettings: {
					...mockEndpointConfig.endpointSettings,
					webrtcWidgetConfig: {
						...mockEndpointConfig.endpointSettings.webrtcWidgetConfig,
						active: false,
					},
				},
			};

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () => Promise.resolve(inactiveConfig),
			});

			await configManager.fetchConfig();
			expect(configManager.isActive()).toBe(false);
		});
	});

	describe('getPrivacySettings', () => {
		it('should return privacy settings from config', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);
			await configManager.fetchConfig();

			const privacySettings = configManager.getPrivacySettings();
			expect(privacySettings).toEqual(mockEndpointConfig.settings?.privacyNotice);
		});

		it('should return default privacy settings when no config is loaded', () => {
			const defaultSettings = configManager.getPrivacySettings();
			expect(defaultSettings).toEqual({
				enabled: false,
				text: '',
				cancelButtonText: 'Cancel',
				submitButtonText: 'Accept',
				urlText: '',
				url: '',
			});
		});
	});

	describe('clearConfig', () => {
		it('should clear cached configuration', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);
			await configManager.fetchConfig();

			expect(configManager.getConfig()).not.toBeNull();

			configManager.clearConfig();
			expect(configManager.getConfig()).toBeNull();
		});

		const deferredFetch = () => {
			const pending: Array<(body: unknown) => void> = [];
			global.fetch = vi.fn(
				() =>
					new Promise((resolve) => {
						pending.push((body) => resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }));
					})
			) as any;
			return pending;
		};

		it('does not let a request in flight during clearConfig repopulate the config or userId', async () => {
			const anonymous = new ConfigManager(mockEndpointUrl);
			const pending = deferredFetch();

			const request = anonymous.fetchConfig();
			anonymous.clearConfig();
			pending[0](mockEndpointConfig);
			await request.catch(() => undefined);

			expect(anonymous.getConfig()).toBeNull();
			expect((anonymous as any).userId).toBe('');
		});

		it('does not let an older response overwrite a newer one', async () => {
			const pending = deferredFetch();
			const older = { ...mockEndpointConfig, projectId: 'older' };
			const newer = { ...mockEndpointConfig, projectId: 'newer' };

			const first = configManager.fetchConfig();
			configManager.clearConfig();
			const second = configManager.fetchConfig();
			pending[1](newer);
			await second;
			pending[0](older);
			await first.catch(() => undefined);

			expect(configManager.getConfig()?.projectId).toBe('newer');
			await expect(configManager.fetchConfig()).resolves.toMatchObject({ projectId: 'newer' });
		});
	});

	describe('isConfigValid', () => {
		it('should return true for valid config', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);
			await configManager.fetchConfig();

			expect(configManager.isConfigValid()).toBe(true);
		});

		it('should return false when no config is loaded', () => {
			expect(configManager.isConfigValid()).toBe(false);
		});
	});

});
