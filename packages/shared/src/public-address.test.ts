import { expect,it } from "vitest";
import { isPublicNetworkAddress } from "./public-address.ts";
it.each(["192.0.0.1","192.0.2.1","198.51.100.254","203.0.113.8","192.88.99.1","127.0.0.1","10.0.0.1","169.254.169.254",
 "172.31.255.255","192.168.1.1","100.100.100.200","198.19.1.1","224.0.0.1","255.255.255.255",
 "::1","::ffff:127.0.0.1","::ffff:7f00:1","fd00:ec2::254","fe80::1","2001:db8::1","2001:0:7f00:1::1","2002:7f00:1::1","3fff::1","not-an-ip"])
 ("refuses private, reserved, transition and documentation destination %s",ip=>expect(isPublicNetworkAddress(ip)).toBe(false));
it.each(["8.8.8.8","1.1.1.1","192.0.3.1","198.51.101.1","203.0.114.1","2606:4700:4700::1111","2001:4860:4860::8888"])
 ("allows ordinary public unicast %s",ip=>expect(isPublicNetworkAddress(ip)).toBe(true));
