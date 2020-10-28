import Provider, { ProviderConfiguration } from 'solid-oidc-provider';
export default class SolidIdp extends Provider {
    constructor(issuer: string, config: ProviderConfiguration);
}
