/**
 * Configuration management for the WebRTC SDK
 */

import type { EndpointConfig } from './types/index.js';
import { randomId, validateEndpointConfig, withTimeout } from './utils/helpers.js';

export class ConfigManager {
	private config: EndpointConfig | null = null;
	private readonly endpointUrl: string;
	private userId: string;
	private readonly userProvidedId: boolean;

	constructor(endpointUrl: string, userId?: string) {
		this.endpointUrl = endpointUrl;
		this.userId = userId || '';
		this.userProvidedId = !!userId;
	}

	/**
	 * Fetch configuration from the endpoint
	 */
	async fetchConfig(): Promise<EndpointConfig> {
		if (this.config) {
			return this.config;
		}

		try {
			const response = await withTimeout(
				fetch(this.endpointUrl, {
					method: 'GET',
					headers: {
						'Content-Type': 'application/json',
					},
				}),
				10000 // 10 second timeout
			);

			if (!response.ok) {
				throw new Error(`Failed to fetch config: ${response.status} ${response.statusText}`);
			}

			const config = await response.json();

			if (!validateEndpointConfig(config)) {
				throw new Error('Invalid endpoint configuration received');
			}

			this.config = config;

			if (!this.userProvidedId) {
				const originalEndpointName = config.endpointSettings?.endpointName || '';
				const endpointName = originalEndpointName.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase() || 'endpoint';
				this.userId = `webrtc-sdk-${endpointName}-${randomId()}`;
			}

			return config;
		} catch (error) {
			throw new Error(`Configuration fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	/**
	 * Get the current configuration
	 */
	getConfig(): EndpointConfig | null {
		return this.config;
	}

	/**
	 * Extract SIP credentials from the configuration
	 */
	getSipCredentials() {
		if (!this.config) {
			throw new Error('Configuration not loaded');
		}

		const sipInfo = this.config.endpointSettings.sipConnectivityInfo;

		return {
			fullUsername: `${this.userId ?? ''}@${sipInfo.realm}`,
			userId: this.userId,
			password: sipInfo.password,
			username: sipInfo.username,
			wsUri: sipInfo.wsUri,
			applicationSid: sipInfo.applicationSid,
			realm: sipInfo.realm,
			organisationId: this.config.organisationId,
			projectId: this.config.projectId,
			endpointId: this.config.endpointSettings.endpointId,
		};
	}

	/**
	 * Get the application SID for making calls
	 */
	getApplicationSid(): string {
		if (!this.config) {
			throw new Error('Configuration not loaded');
		}

		return this.config.endpointSettings.sipConnectivityInfo.applicationSid;
	}

	/** Bare endpointId once identity is declared via headers; legacy
	 *  app-<applicationSid> target otherwise. */
	getCallTarget(): string {
		if (!this.config) {
			throw new Error('Configuration not loaded');
		}

		const { organisationId, projectId, endpointSettings } = this.config;
		const { endpointId } = endpointSettings;

		return organisationId && projectId && endpointId
			? endpointId
			: `app-${endpointSettings.sipConnectivityInfo.applicationSid}`;
	}

	/**
	 * Check if the widget is active
	 */
	isActive(): boolean {
		return this.config?.endpointSettings?.webrtcWidgetConfig?.active ?? false;
	}


	/**
	 * Get privacy notice settings
	 */
	getPrivacySettings() {
		return this.config?.settings?.privacyNotice ?? {
			enabled: false,
			text: '',
			cancelButtonText: 'Cancel',
			submitButtonText: 'Accept',
			urlText: '',
			url: '',
		};
	}

	/**
	 * Clear the cached configuration
	 */
	clearConfig(): void {
		this.config = null;
	}

	/**
	 * Validate the current configuration
	 */
	isConfigValid(): boolean {
		return this.config ? validateEndpointConfig(this.config) : false;
	}

	/**
	 * Get WebRTC peer connection configuration
	 */
	getPeerConnectionConfig(): RTCConfiguration | undefined {
		// Default STUN servers - can be overridden by client config
		return undefined;
	}
}

/**
 * Create a configuration manager instance
 */
export function createConfigManager(endpointUrl: string): ConfigManager {
	return new ConfigManager(endpointUrl);
}
