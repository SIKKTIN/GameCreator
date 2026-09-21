import type {DocumentFile} from '../shared/ai-document-files.mjs';

// ZIP method 0 keeps UTF-8 Markdown portable without a runtime compression dependency.
const crcTable=Uint32Array.from({length:256},(_,i)=>{let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=(data:Uint8Array)=>{let n=0xffffffff;for(const byte of data)n=crcTable[(n^byte)&255]^(n>>>8);return (n^0xffffffff)>>>0;};
export function buildDocumentZip(folderName:string,files:DocumentFile[]):Uint8Array<ArrayBuffer> {
  const encoder=new TextEncoder(),local:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0;
  const header=(size:number)=>{const bytes=new Uint8Array(size);return {bytes,view:new DataView(bytes.buffer)};};
  for(const file of files) {
    const name=encoder.encode(folderName+'/'+file.path),data=encoder.encode(file.content),crc=crc32(data);
    const h=header(30);h.view.setUint32(0,0x04034b50,true);h.view.setUint16(4,20,true);h.view.setUint16(6,0x800,true);
    h.view.setUint16(12,33,true);h.view.setUint32(14,crc,true);h.view.setUint32(18,data.length,true);h.view.setUint32(22,data.length,true);h.view.setUint16(26,name.length,true);
    local.push(h.bytes,name,data);
    const c=header(46);c.view.setUint32(0,0x02014b50,true);c.view.setUint16(4,20,true);c.view.setUint16(6,20,true);c.view.setUint16(8,0x800,true);c.view.setUint16(14,33,true);
    c.view.setUint32(16,crc,true);c.view.setUint32(20,data.length,true);c.view.setUint32(24,data.length,true);c.view.setUint16(28,name.length,true);c.view.setUint32(42,offset,true);
    central.push(c.bytes,name);offset+=h.bytes.length+name.length+data.length;
  }
  const centralSize=central.reduce((n,b)=>n+b.length,0),end=header(22);
  end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,files.length,true);end.view.setUint16(10,files.length,true);end.view.setUint32(12,centralSize,true);end.view.setUint32(16,offset,true);
  const out=new Uint8Array(offset+centralSize+22);let cursor=0;for(const part of [...local,...central,end.bytes]){out.set(part,cursor);cursor+=part.length;}return out;
}
