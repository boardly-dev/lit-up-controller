import { Button } from "@/components/ui/button";
import { useContext, useEffect, useState } from "react";
import LitContext, { SignatureData } from "./contexts/LitContext";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  setDoc,
} from "firebase/firestore";

import * as ethers from "ethers";

import UniversalProfileContract from "@lukso/lsp-smart-contracts/artifacts/UniversalProfile.json";
import KeyManagerContract from "@lukso/lsp-smart-contracts/artifacts/LSP6KeyManager.json";

import { EIP191Signer } from "@lukso/eip191-signer.js";
import { formatEther, recoverAddress } from "ethers/lib/utils";
import { Separator } from "./components/ui/separator";

const DEPLOYER_URL =
  "https://lukso-deployer.shashanksolanki97.workers.dev/deploy";

const LSP25_VERSION = 25;

const provider = new ethers.providers.JsonRpcProvider(
  "https://rpc.testnet.lukso.network",
);

type ProfileProps = {
  address: string;
  testSend: () => Promise<void>;
};
function ProfieCard({ address, testSend }: ProfileProps) {
  const [keyManager, setKeyManager] = useState<string | undefined>();
  const [balance, setBalance] = useState<ethers.BigNumber>();
  const [greetingMessage, setGreetingMessage] = useState<string>("Not Set");

  useEffect(() => {
    // Setup the contract instance of the Universal Profile
    const universalProfile = new ethers.Contract(
      address, // Universal Profile address
      UniversalProfileContract.abi,
      provider, // controller address with permissions on the Universal Profile
    );

    // Call the Universal Profile contract to get the Key Manager
    universalProfile.owner().then(setKeyManager);
    provider.getBalance(address).then(setBalance);

    const greetingMessageKey = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes("profile-greeting-message"),
    );

    universalProfile
      .getData(greetingMessageKey)
      .then((message: ethers.BytesLike) =>
        setGreetingMessage(ethers.utils.toUtf8String(message)),
      );
  }, []);

  return (
    <div className="mb-2">
      <p>{address}</p>
      <small>Key Manager: {keyManager}</small>
      <br />
      <small>Balance: {balance ? formatEther(balance) : "N/A"}</small>
      <br />
      <small>Message: {greetingMessage}</small>
      <br />
      <Button variant="outline" onClick={testSend}>
        Set Message
      </Button>
    </div>
  );
}

type ProfileManagerProps = {
  account: string;
  signMessage: (
    message: string,
  ) => Promise<SignatureData | undefined> | undefined;
};

type MappedProfile = {
  address: string;
  txnHash: string;
};

function ProfileManager({ account, signMessage }: ProfileManagerProps) {
  const [profiles, setProfiles] = useState<MappedProfile[]>([]);

  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        const db = getFirestore();

        onSnapshot(doc(db, `profiles/${account}`), (snap) => {
          const data = snap.data();

          if (!data) {
            return;
          }

          setProfiles(data.profiles);
        });
      } catch (error) {
        console.error("Error fetching profiles: ", error);
      }
    };

    fetchProfiles();
  }, [account]);

  async function signSomething(profileAddress: string) {
    const greetingMessage = prompt("Enter Greeting Message:");

    if (!greetingMessage) {
      alert("Greeting message is required");

      return;
    }

    // Setup the contract instance of the Universal Profile
    const universalProfile = new ethers.Contract(
      profileAddress, // Universal Profile address
      UniversalProfileContract.abi,
      provider, // controller address with permissions on the Universal Profile
    );

    // Call the Universal Profile contract to get the Key Manager
    const keyManagerAddress = await universalProfile.owner();

    // Setup the contract instance of the Key Manager
    const keyManager = new ethers.Contract(
      keyManagerAddress,
      KeyManagerContract.abi,
      provider,
    );

    const channelId = 0;

    // Retrieve the nonce of the EOA controller
    const nonce = await keyManager.getNonce(account, channelId);
    const validityTimestamps = 0; // No validity timestamp set
    const msgValue = 0; // Amount of native tokens to fund the UP with while calling

    console.log(nonce.toString(), profileAddress, keyManagerAddress);

    // Generate the payload of the transaction
    const abiPayload = universalProfile.interface.encodeFunctionData(
      "setData",
      [
        ethers.utils.keccak256(
          ethers.utils.toUtf8Bytes("profile-greeting-message"),
        ),
        ethers.utils.toUtf8Bytes(greetingMessage),
      ],
    );

    // Get the network ID
    const { chainId } = await provider.getNetwork();

    // Encode the Message
    const encodedMessage = ethers.utils.solidityPack(
      // Types of the parameters that will be encoded
      ["uint256", "uint256", "uint256", "uint256", "uint256", "bytes"],
      [
        // MUST be number `25`
        // Encoded value: `0x0000000000000000000000000000000000000000000000000000000000000019`
        LSP25_VERSION,

        // e.g: `4201` for LUKSO Testnet
        // Encoded value: `0x0000000000000000000000000000000000000000000000000000000000001069`
        chainId,

        // e.g: nonce number 5 of the signing controller that wants to execute the payload
        // Encoded value: `0x0000000000000000000000000000000000000000000000000000000000000005`
        nonce,

        // e.g: valid until 1st January 2025 at midnight (GMT).
        // Timestamp = 1735689600
        // Encoded value: `0x0000000000000000000000000000000000000000000000000000000067748580`
        validityTimestamps,

        // e.g: not funding the contract with any LYX (0)
        // Encoded value: `0x0000000000000000000000000000000000000000000000000000000000000000`
        msgValue,

        // e.g: send 3 LYX to address 0xcafecafecafecafecafecafecafecafecafecafe
        // by calling execute(uint256,address,uint256,bytes)
        // Encoded value: `0x44c028fe00000000000000000000000000000000000000000000000000000000
        //                 00000000000000000000000000000000cafecafecafecafecafecafecafecafeca
        //                 fecafecafecafe00000000000000000000000000000000000000000000000029a2
        //                 241af62c0000000000000000000000000000000000000000000000000000000000
        //                 000000008000000000000000000000000000000000000000000000000000000000
        //                 00000000`
        abiPayload,
      ],
    );

    // Instantiate EIP191 Signer
    const eip191Signer = new EIP191Signer();

    const eip191Message = eip191Signer.hashDataWithIntendedValidator(
      keyManagerAddress,
      encodedMessage,
    );

    const signature = await signMessage(eip191Message);

    if (!signature) {
      console.log("signature not defined");

      return;
    }

    console.log(eip191Message, signature, signature.dataSigned);

    console.log(recoverAddress(eip191Message, signature.signature));

    const relayerPrivateKey =
      "c0de3b8084849f58ae1c7178f638cd5c8e974a351e59b708c33be96d057deef1";
    const relayControllerAccount = new ethers.Wallet(relayerPrivateKey).connect(
      provider,
    );

    console.log("Payload", abiPayload);

    try {
      // Estimate gas limit for the transaction
      const estimatedGas = await keyManager.estimateGas.executeRelayCall(
        signature.signature,
        nonce,
        validityTimestamps,
        abiPayload,
      );

      console.log("Estimated Gas:", estimatedGas.toString());

      const executeRelayCallTransaction = await keyManager
        .connect(relayControllerAccount)
        .executeRelayCall(
          signature.signature,
          nonce,
          validityTimestamps,
          abiPayload,
          { gasLimit: estimatedGas }, // Use estimated gas limit
        );

      console.log(executeRelayCallTransaction);
      const receipt = await executeRelayCallTransaction.wait();
      console.log("Transaction receipt:", receipt);
    } catch (err) {
      if (err.error && err.error.body) {
        const parsedError = JSON.parse(err.error.body);
        console.log(parsedError);

        console.log(keyManager.interface.format(parsedError.error.data));
      } else {
        console.log(err);
      }
    }
  }

  async function createProfile() {
    const reqUrl = new URL(DEPLOYER_URL);

    reqUrl.searchParams.set("controller", account);

    const res = await fetch(reqUrl.toString());
    const data = await res.json();

    const { universalProfileAddress, transactionHash } = data.res;

    const db = getFirestore();
    const docData = await getDoc(doc(db, `profiles/${account}`));
    const existingProfiles = docData.get("profiles");

    console.log(existingProfiles);

    const newProfiles = [
      { address: universalProfileAddress, txnHash: transactionHash },
    ].concat(existingProfiles ? existingProfiles : []);

    await setDoc(doc(db, `profiles/${account}`), { profiles: newProfiles });
  }

  return (
    <div className="w-full">
      <div className="mb-8 flex flex-row justify-between">
        <div>
          <h2 className="text-2xl">Profiles</h2>
          <small>Signer: {account}</small>
        </div>
        <Button className="float-right" onClick={() => createProfile()}>
          Create Profile
        </Button>
      </div>
      <ol>
        {profiles.map((profile) => (
          <li className="border rounded-lg mb-2 p-4" key={profile.address}>
            <ProfieCard
              address={profile.address}
              testSend={() => signSomething(profile.address)}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function App() {
  const {
    ready,
    accounts,
    authenticate,
    googleSignIn,
    setActiveKey,
    activeAccount,
    signMessage,
  } = useContext(LitContext);
  useEffect(() => {
    if (!authenticate) return;

    authenticate();
  }, []);

  function signMessageWithKey(message: string) {
    if (!signMessage) {
      console.log("sign message not defined");

      return;
    }

    return signMessage(message as string);
  }

  if (!ready) {
    return (
      <CardContent>
        <p>Loading Lit Lukso Controller</p>
      </CardContent>
    );
  }

  if (googleSignIn && accounts.length === 0) {
    return (
      <CardContent>
        <Button onClick={googleSignIn}>Authenticate With Google</Button>{" "}
      </CardContent>
    );
  }

  return (
    <>
      <CardContent>
        <div className="space-y-4">
          <Select onValueChange={setActiveKey}>
            <SelectTrigger>
              <SelectValue placeholder="Select PKP" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((acc) => (
                <SelectItem key={acc} value={acc}>
                  {acc}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
      <CardFooter>
        <div className="block w-full">
          {activeAccount && (
            <ProfileManager
              account={activeAccount}
              signMessage={signMessageWithKey}
            />
          )}
        </div>
      </CardFooter>
    </>
  );
}

function Container() {
  return (
    <Card className="w-[640px] mx-auto mt-16">
      <CardHeader>
        <CardTitle>Lit Lukso Controller</CardTitle>
      </CardHeader>
      <App />
    </Card>
  );
}

export default Container;
