/* ============================================================
   SHARRI — Gjeneruesi i kodit QR (pa varësi, vetëm në shfletues)
   ============================================================ */

/* ======= QR GENERATOR (offline) ======= */
const QRImpl = (() => {
const mul = (x,y) => { let z=0; for(let i=7;i>=0;i--){ z=(z<<1)^((z>>>7)*0x11D); z^=((y>>>i)&1)*x; } return z; };
function rsDiv(deg){ const r=new Array(deg-1).fill(0); r.push(1); let root=1;
  for(let i=0;i<deg;i++){ for(let j=0;j<r.length;j++){ r[j]=mul(r[j],root); if(j+1<r.length) r[j]^=r[j+1]; } root=mul(root,2); } return r; }
function rsRem(data,div){ const res=div.map(()=>0);
  for(const b of data){ const f=b^res.shift(); res.push(0); div.forEach((c,i)=>res[i]^=mul(c,f)); } return res; }
const VERS = [
  {v:1,cap:17,dc:19,ec:7,bl:1,aligns:[]},
  {v:2,cap:32,dc:34,ec:10,bl:1,aligns:[6,18]},
  {v:3,cap:53,dc:55,ec:15,bl:1,aligns:[6,22]},
  {v:4,cap:78,dc:80,ec:20,bl:1,aligns:[6,26]},
  {v:5,cap:106,dc:108,ec:26,bl:1,aligns:[6,30]},
  {v:6,cap:134,dc:136,ec:18,bl:2,aligns:[6,34]},
  {v:7,cap:154,dc:156,ec:20,bl:2,aligns:[6,22,38]}
];
function matrix(text){
  const bytes=[...new TextEncoder().encode(text)];
  let V=VERS[VERS.length-1]; for(const v of VERS){ if(bytes.length<=v.cap){ V=v; break; } }
  const dataBytes=bytes.slice(0,V.cap); const bits=[];
  const push=(val,n)=>{ for(let i=n-1;i>=0;i--) bits.push((val>>>i)&1); };
  push(4,4); push(dataBytes.length,8); dataBytes.forEach(b=>push(b,8));
  const capBits=V.dc*8;
  for(let i=0;i<4&&bits.length<capBits;i++) bits.push(0);
  while(bits.length%8) bits.push(0);
  for(let pad=0xEC; bits.length<capBits; pad^=0xFD) push(pad,8);
  const all=[]; for(let i=0;i<bits.length;i+=8){ let b=0; for(let j=0;j<8;j++) b=(b<<1)|bits[i+j]; all.push(b); }
  const blocks=[]; const per=V.dc/V.bl;
  for(let b=0;b<V.bl;b++){ const d=all.slice(b*per,(b+1)*per); blocks.push({d,e:rsRem(d,rsDiv(V.ec))}); }
  const seq=[]; for(let i=0;i<per;i++) blocks.forEach(bl=>seq.push(bl.d[i]));
  for(let i=0;i<V.ec;i++) blocks.forEach(bl=>seq.push(bl.e[i]));
  const size=17+4*V.v;
  const M=Array.from({length:size},()=>new Array(size).fill(false));
  const F=Array.from({length:size},()=>new Array(size).fill(false));
  const set=(x,y,d)=>{ M[y][x]=d; F[y][x]=true; };
  const finder=(cx,cy)=>{ for(let dy=-4;dy<=4;dy++) for(let dx=-4;dx<=4;dx++){ const x=cx+dx,y=cy+dy; if(x<0||y<0||x>=size||y>=size) continue; const dist=Math.max(Math.abs(dx),Math.abs(dy)); set(x,y,dist!==2&&dist!==4); } };
  finder(3,3); finder(size-4,3); finder(3,size-4);
  for(let i=0;i<size;i++){ set(6,i,i%2===0); set(i,6,i%2===0); }
  if(V.aligns.length){ const C=V.aligns; const last=C[C.length-1];
    for(const cy of C) for(const cx of C){
      if((cy===6&&cx===6)||(cy===6&&cx===last)||(cy===last&&cx===6)) continue;
      for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) set(cx+dx,cy+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
    }
  }
  let data5=(1<<3)|0, rem=data5;
  for(let i=0;i<10;i++) rem=(rem<<1)^((rem>>>9)*0x537);
  const fbits=((data5<<10)|rem)^0x5412;
  const gb=(x,i)=>((x>>>i)&1)!==0;
  for(let i=0;i<=5;i++) set(8,i,gb(fbits,i));
  set(8,7,gb(fbits,6)); set(8,8,gb(fbits,7)); set(7,8,gb(fbits,8));
  for(let i=9;i<15;i++) set(14-i,8,gb(fbits,i));
  for(let i=0;i<8;i++) set(size-1-i,8,gb(fbits,i));
  for(let i=8;i<15;i++) set(8,size-15+i,gb(fbits,i));
  set(8,size-8,true);
  let bi=0;
  for(let right=size-1; right>=1; right-=2){
    if(right===6) right=5;
    for(let vert=0; vert<size; vert++){
      for(let j=0;j<2;j++){
        const x=right-j; const up=((right+1)&2)===0; const y=up?size-1-vert:vert;
        if(!F[y][x]&&bi<seq.length*8){ M[y][x]=gb(seq[bi>>>3],7-(bi&7)); bi++; }
      }
    }
  }
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) if(!F[y][x]&&(x+y)%2===0) M[y][x]=!M[y][x];
  return M;
}
function dataUrl(text, scale=4, quiet=4){
  const m=matrix(text), n=m.length, dim=(n+quiet*2)*scale;
  const c=document.createElement("canvas"); c.width=dim; c.height=dim;
  const ctx=c.getContext("2d");
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,dim,dim);
  ctx.fillStyle="#000";
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) if(m[y][x]) ctx.fillRect((x+quiet)*scale,(y+quiet)*scale,scale,scale);
  return c.toDataURL("image/png");
}
return { dataUrl };
})();


export const QR = QRImpl;
export default QRImpl;
