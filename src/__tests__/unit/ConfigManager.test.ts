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
		it('should fetch configuration successfully', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);

			const config = await configManager.fetchConfig();

			expect(fetch).toHaveBeenCalledWith(mockEndpointUrl, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				},
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

		it('should handle invalid configuration response', async () => {
			const invalidResponse = {
				ok: true,
				status: 200,
				json: () => Promise.resolve({ invalid: 'config' }),
			};
			global.fetch = vi.fn().mockResolvedValue(invalidResponse);

			await expect(configManager.fetchConfig()).rejects.toThrow(
				'Invalid endpoint configuration received'
			);
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

	const legacyConfigWithIds = () => ({
		ok: true,
		status: 200,
		json: () =>
			Promise.resolve({
				...mockEndpointConfig,
				endpointSettings: { ...mockEndpointConfig.endpointSettings, endpointId: 'endpoint-1' },
			}),
	});

	describe('getSipCredentials', () => {
		it('does not declare the endpointId for a legacy endpoint, even when the config carries it', async () => {
			global.fetch = vi.fn().mockResolvedValue(legacyConfigWithIds());
			await configManager.fetchConfig();

			const credentials = configManager.getSipCredentials();
			expect(credentials.organisationId).toBe('test-org-id');
			expect(credentials.projectId).toBe('test-project-id');
			expect(credentials.endpointId).toBeUndefined();
			expect(credentials.realm).toBe('sip.example.com');
		});

		it('includes organisationId/projectId/endpointId for a runtime endpoint', async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: () =>
					Promise.resolve({
						...mockEndpointConfig,
						endpointSettings: {
							...mockEndpointConfig.endpointSettings,
							endpointId: 'endpoint-1',
							sipConnectivityInfo: { wsUri: 'wss://sip.example.com:8443' },
						},
					}),
			});
			await configManager.fetchConfig();

			const credentials = configManager.getSipCredentials();
			expect(credentials.organisationId).toBe('test-org-id');
			expect(credentials.projectId).toBe('test-project-id');
			expect(credentials.endpointId).toBe('endpoint-1');
		});
	});

	describe('getCallTarget', () => {
		it('dials app-<applicationSid> when the config has no endpointId (legacy endpoint)', async () => {
			global.fetch = vi.fn().mockResolvedValue(mockFetchResponses.success);
			await configManager.fetchConfig();

			expect(configManager.getCallTarget()).toBe('app-00000000-0000-0000-0000-000000000002');
		});

		it('dials the bare endpointId for a runtime endpoint (declared ids, no SIP credentials)', async () => {
			const runtimeConfig = {
				...mockEndpointConfig,
				endpointSettings: {
					...mockEndpointConfig.endpointSettings,
					endpointId: 'endpoint-1',
					sipConnectivityInfo: { wsUri: 'wss://sip.example.com:8443' },
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

		it('still dials app-<applicationSid> for a legacy endpoint whose config also carries the declared ids', async () => {
			global.fetch = vi.fn().mockResolvedValue(legacyConfigWithIds());
			await configManager.fetchConfig();

			expect(configManager.getCallTarget()).toBe('app-00000000-0000-0000-0000-000000000002');
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
