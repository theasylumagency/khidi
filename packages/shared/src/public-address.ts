import { isIP } from "node:net";
/** Conservative destination policy for untrusted webhook/push URLs, not operator DB/storage config. */
export function isPublicNetworkAddress(address:string):boolean {
 const family=isIP(address);
 if(family===4) {
  const [a,b,c]=address.split(".").map(Number) as [number,number,number,number];
  return a!==0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)
   &&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19))
   &&!(a===192&&(b===168||b===0&&(c===0||c===2)||b===88&&c===99))
   &&!(a===198&&b===51&&c===100)&&!(a===203&&b===0&&c===113);
 }
 if(family!==6||address.includes(".")||address.includes("%"))return false;
 const halves=address.toLowerCase().split("::"),left=halves[0]?halves[0].split(":"):[],right=halves[1]?halves[1].split(":"):[];
 const parts=halves.length===2?[...left,...Array(8-left.length-right.length).fill("0"),...right]:left;
 if(parts.length!==8||parts.some(p=>!/^[a-f0-9]{1,4}$/.test(p)))return false;
 const a=parseInt(parts[0]!,16),b=parseInt(parts[1]!,16);
 // Global unicast only, without special-purpose protocol, transition or documentation prefixes.
 return a>=0x2000&&a<0x4000&&!(a===0x2001&&(b<0x200||b===0xdb8))
  &&a!==0x2002&&a!==0x3ffe&&!(a===0x3fff&&(b&0xf000)===0);
}
