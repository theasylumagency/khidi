import { createECDH } from "node:crypto";
export const DEVELOPMENT_VAPID_PUBLIC="BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
export const DEVELOPMENT_VAPID_PRIVATE="UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls";
export function vapidConfig(env:NodeJS.ProcessEnv=process.env) {
 const production=env.NODE_ENV==="production",publicKey=env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()??(production?"":DEVELOPMENT_VAPID_PUBLIC),privateKey=env.VAPID_PRIVATE_KEY?.trim()??(production?"":DEVELOPMENT_VAPID_PRIVATE),subject=env.VAPID_SUBJECT?.trim()??"https://app.khidi.app";
 if(production&&(!publicKey||!privateKey||publicKey===DEVELOPMENT_VAPID_PUBLIC||privateKey===DEVELOPMENT_VAPID_PRIVATE))throw new Error("CRITICAL: New production VAPID keys are required; development keys are forbidden.");
 if(!/^[A-Za-z0-9_-]{87}$/.test(publicKey)||!/^[A-Za-z0-9_-]{43}$/.test(privateKey))throw new Error("CRITICAL: Invalid VAPID key configuration.");
 try{const ecdh=createECDH("prime256v1");ecdh.setPrivateKey(Buffer.from(privateKey,"base64url"));if(ecdh.getPublicKey().toString("base64url")!==publicKey)throw new Error();}catch{throw new Error("CRITICAL: VAPID public/private keys must be a matching pair.");}
 if(production&&subject!=="https://app.khidi.app" || !production&&!/^(https:\/\/|mailto:)/.test(subject))throw new Error("CRITICAL: Configure the neutral VAPID subject (production: https://app.khidi.app).");
 return {publicKey,privateKey,subject};
}
