import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { LitProvider } from "./contexts/LitContext.tsx";

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDMZKh1IDTECMym0xXLzZFlblT5VyRn8mY",
  authDomain: "lit-lukso-signer.firebaseapp.com",
  projectId: "lit-lukso-signer",
  storageBucket: "lit-lukso-signer.firebasestorage.app",
  messagingSenderId: "880450376902",
  appId: "1:880450376902:web:897792f3a7568a878233c7",
};

// Initialize Firebase
initializeApp(firebaseConfig);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LitProvider>
      <App />
    </LitProvider>
  </StrictMode>,
);
