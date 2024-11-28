import { createContext, ReactNode, useEffect, useState } from "react";

import { ProviderType, AuthMethodScope } from "@lit-protocol/constants";

import {
  AuthMethod,
  IRelayPKP,
  MintRequestBody,
  SessionSigsMap,
} from "@lit-protocol/types";

import {
  BaseProvider,
  LitAuthClient,
  isSignInRedirect,
} from "@lit-protocol/lit-auth-client";

import {
  LitAbility,
  LitPKPResource,
  LitActionResource,
  LitAccessControlConditionResource,
} from "@lit-protocol/auth-helpers";
import { BytesLike, ethers } from "ethers";

const litAuthClient = new LitAuthClient({
  litRelayConfig: {
    // Request a Lit Relay Server API key here: https://forms.gle/RNZYtGYTY9BcD9MEA
    relayApiKey: "d3r6yk0o-vxwf-9qsg-4rjj-14ybfpkksm4c_boardly",
  },
});

litAuthClient.initProvider(ProviderType.Google, {
  // The URL of your web app where users will be redirected after authentication
  // redirectUri: "https://lit-signer-lukso.web.app/callback",
  redirectUri: "http://localhost:5173/callback",
});

const LitContext = createContext<{
  ready: boolean;
  client: LitAuthClient;
  googleSignIn?: () => unknown;
  mintKey?: (providerType: ProviderType, authMethod: AuthMethod) => unknown;
  authenticate?: () => unknown;
  accounts: string[];
  activeAccount?: string;
  setActiveKey?: (account: string) => unknown;
  signMessage?: (message: string) => Promise<SignatureData | undefined>;
}>({
  ready: false,
  client: litAuthClient,
  accounts: [],
});

async function handleRedirect(client: LitAuthClient) {
  // Check if app has been redirected from Lit login server
  if (isSignInRedirect(window.location.toString())) {
    console.log("sign in with redirect url");
    // Get the provider that was used to sign in
    const provider = client.getProvider(ProviderType.Google);

    // Get auth method object that has the OAuth token from redirect callback
    return provider?.authenticate();
  }
}

type AuthMethodKeys = {
  method: AuthMethod;
  keys: Record<string, IRelayPKP>;
};

export type SignatureData = {
  dataSigned: string;
  publicKey: string;
  r: string;
  recid: number;
  s: string;
  signature: string;
};

export function LitProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState<boolean>(false);
  const [authMethods, setAuthMethods] = useState<
    Record<ProviderType, AuthMethodKeys>
  >({} as Record<ProviderType, AuthMethodKeys>);
  const [activeKey, setActiveKey] = useState<IRelayPKP | null>();
  const [sessionSigs, setSessionSigs] = useState<SessionSigsMap | null>();
  const [activeProviderType, setProviderType] = useState<ProviderType | null>();
  const [accounts, setAccounts] = useState<string[]>([]);

  useEffect(() => {
    if (Object.keys(authMethods).length !== 0) {
      return;
    }

    console.log("Loading local auth methods");

    const methods = JSON.parse(
      localStorage.getItem("auth_methods") || "[]",
    ) as ProviderType[];

    if (methods.length === 0) {
      setReady(true);
    }

    for (const providerType of methods) {
      const rawAuthMethod = localStorage.getItem(`auth_method_${providerType}`);

      if (!rawAuthMethod) {
        return;
      }

      addAuthMethod(providerType, JSON.parse(rawAuthMethod) as AuthMethod);
    }
  }, []);

  useEffect(() => {
    if (!activeKey) {
      return;
    }

    if (!activeProviderType) {
      return;
    }

    console.log("getting session signatures");

    getSessionSigs(activeProviderType, activeKey).then(setSessionSigs);
  }, [activeKey]);

  useEffect(() => {
    const client = litAuthClient.litNodeClient;

    if (!activeProviderType) {
      console.log("active provider not found");

      return;
    }

    if (!activeKey) {
      console.log("active key not found");

      return;
    }

    if (!sessionSigs) {
      console.log("session signatures not found");

      getSessionSigs(activeProviderType, activeKey).then(setSessionSigs);

      return;
    }

    client
      .connect()
      .then(() => {
        setReady(true);
      })
      .catch((err) => {
        console.log(JSON.stringify(err));
      });
  }, [sessionSigs]);

  useEffect(() => {
    if (Object.keys(authMethods).length === 0) {
      return;
    }

    const methodsList = Object.keys(authMethods);

    localStorage.setItem("auth_methods", JSON.stringify(methodsList));

    for (const methodKey of methodsList) {
      const method = authMethods[methodKey as ProviderType].method;

      localStorage.setItem(`auth_method_${methodKey}`, JSON.stringify(method));
    }
  }, [authMethods]);

  async function signMessage(message: BytesLike) {
    const litActionCode = `
        const go = async () => {
        // The params toSign, publicKey, sigName are passed from the jsParams fields and are available here
        const sigShare = await Lit.Actions.signEcdsa({ toSign, publicKey, sigName });
        };

        go();
    `;

    const toSign = ethers.utils.arrayify(message);

    if (!sessionSigs) {
      console.log("Session signatures not found");

      return;
    }

    const nodeClient = litAuthClient.litNodeClient;

    await nodeClient.connect();

    const signResponse = await litAuthClient.litNodeClient.executeJs({
      code: litActionCode,
      sessionSigs,
      jsParams: {
        toSign: toSign,
        publicKey: activeKey?.publicKey,
        sigName: "sig1",
      },
    });

    console.log(signResponse.signatures.sig1);

    return signResponse.signatures.sig1 as SignatureData;
  }

  function googleSignIn() {
    const provider = litAuthClient.getProvider(ProviderType.Google);

    // @ts-expect-error don't know what is wrong here
    return provider?.signIn();
  }

  async function addAuthMethod(
    authMethodType: ProviderType,
    authMethod: AuthMethod,
  ) {
    console.log("Adding auth method");

    const provider = litAuthClient.getProvider(authMethodType);

    if (!provider) {
      throw Error(
        `Provider (${authMethodType}) might not have been initialised`,
      );
    }

    console.log("Set Provider type");

    setProviderType(authMethodType);

    let keys = await fetchKeys(provider, authMethod);

    if (keys.length === 0) {
      console.log("No keys found, minting a new key");
      await mintKey(authMethodType, authMethod);

      keys = await fetchKeys(provider, authMethod);
    }

    setActiveKey(keys[0]);

    const methodKeys: AuthMethodKeys = {
      method: authMethod,
      keys: keys.reduce(
        (acc, key) => {
          acc[key.ethAddress] = key;

          return acc;
        },
        {} as Record<string, IRelayPKP>,
      ),
    };

    setAccounts(Object.keys(methodKeys.keys));

    setAuthMethods(
      Object.assign({ [authMethodType]: methodKeys }, authMethods),
    );
  }

  function mintKey(providerType: ProviderType, authMethod: AuthMethod) {
    const provider = litAuthClient.getProvider(providerType);

    if (!provider) {
      throw new Error("Provider not initialized");
    }

    // -- setting scope for the auth method
    // <https://developer.litprotocol.com/v3/sdk/wallets/auth-methods/#auth-method-scopes>
    const options: MintRequestBody = {
      permittedAuthMethodScopes: [[AuthMethodScope.SignAnything]],
    };

    return provider.mintPKPThroughRelayer(authMethod, options);
  }

  function fetchKeys(provider: BaseProvider, authMethod: AuthMethod) {
    return provider.fetchPKPsThroughRelayer(authMethod);
  }

  function authenticate() {
    handleRedirect(litAuthClient).then((authMethod) => {
      return (
        addAuthMethod &&
        authMethod &&
        addAuthMethod(ProviderType.Google, authMethod)
      );
    });
  }

  async function getSessionSigs(
    providerType: ProviderType,
    activeKey: IRelayPKP,
  ) {
    const provider = litAuthClient.getProvider(providerType);

    if (!provider) {
      throw new Error("Provider not init");
    }

    const authMethod = authMethods[providerType];
    const nodeClient = provider.litNodeClient;

    await nodeClient.connect();

    return nodeClient.getPkpSessionSigs({
      authMethods: [authMethod.method],
      pkpPublicKey: activeKey.publicKey, // Note, an AuthMethod can own more than one PKP
      expiration: new Date(Date.now() + 1000 * 60 * 10).toISOString(),
      resourceAbilityRequests: [
        {
          resource: new LitPKPResource("*"),
          ability: LitAbility.PKPSigning,
        },
        {
          resource: new LitActionResource("*"),
          ability: LitAbility.LitActionExecution,
        },
        {
          resource: new LitAccessControlConditionResource("*"),
          ability: LitAbility.AccessControlConditionDecryption,
        },
      ],
    });
  }

  return (
    <LitContext.Provider
      value={{
        ready: ready,
        client: litAuthClient,
        googleSignIn,
        mintKey,
        authenticate,
        accounts,
        activeAccount: activeKey ? activeKey.ethAddress : undefined,
        signMessage: (message: string) => signMessage(message),
      }}
    >
      {children}
    </LitContext.Provider>
  );
}

export default LitContext;
