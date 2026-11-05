'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const table = Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++) n=(n&1)?(0xedb88320^(n>>>1)):(n>>>1);return n>>>0;});
function crc32(data){let c=0xffffffff; for(const b of data)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function zip(entries){let offset=0, locals=[], central=[]; for(const [name,data] of entries){const filename=Buffer.from(name);const compressed=zlib.deflateRawSync(data);const crc=crc32(data);const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(8,8);h.writeUInt32LE(crc,14);h.writeUInt32LE(compressed.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(filename.length,26);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);locals.push(h,filename,compressed);central.push(c,filename);offset+=h.length+filename.length+compressed.length;}const cd=Buffer.concat(central), end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,cd,end]);}
function build(c){
 if(!c || !/^[A-Za-z0-9_-]{1,64}$/.test(c.site||'') || !/^[A-Za-z0-9.:-]{1,253}$/.test(c.server||'') || !/^[0-9a-fA-F]{64}$/.test(c.psk||'')) throw Error('Invalid server, site, or PSK (64 hexadecimal characters required)');
 const run="$ErrorActionPreference = 'Stop'\r\n& (Join-Path $PSScriptRoot 'deploy-autoreg.ps1') -Site '"+c.site+"' -Server '"+c.server+"' -RegistrationKey '"+c.psk+"'\r\nif (-not $?) { exit 1 }\r\n";
 const archive=zip([['deploy-autoreg.ps1',fs.readFileSync(path.join(__dirname,'deploy-autoreg.ps1'))],['run.ps1',Buffer.from(run)]]);const size=Buffer.alloc(8);size.writeBigInt64LE(BigInt(archive.length));return Buffer.concat([fs.readFileSync(path.join(__dirname,'launcher.exe')),archive,size]);
}
module.exports={build};
