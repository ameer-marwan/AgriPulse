/** Photographic layers, animated from bare soil to two open leaves. */
export function createPlantGrowth(canvas, scene) {
  const context=canvas.getContext('2d',{alpha:false});
  let disposed=false, layers=null, width=960, height=540;
  const smooth=(a,b,x)=>{const p=Math.max(0,Math.min(1,(x-a)/(b-a)));return p*p*(3-2*p);};
  const load=src=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=src;});
  const layer=(source,points)=>{
    const c=document.createElement('canvas');c.width=width;c.height=height;
    const ctx=c.getContext('2d');ctx.beginPath();
    points.forEach(([x,y],i)=>i?ctx.lineTo(x*width,y*height):ctx.moveTo(x*width,y*height));
    ctx.closePath();ctx.clip();ctx.drawImage(source,0,0);return c;
  };
  function drawLayer(source,origin,sx,sy,rotation,stemX,stemY,alpha=1){
    const bx=.474*width,by=.836*height,ox=origin[0]*width,oy=origin[1]*height;
    context.save();context.globalAlpha=alpha;
    context.translate(bx+(ox-bx)*stemX,by+(oy-by)*stemY);
    context.rotate(rotation);context.scale(Math.max(.001,sx),Math.max(.001,sy));
    context.drawImage(source,-ox,-oy);context.restore();
  }
  function draw(seconds){
    if(disposed||!layers||!context)return;
    const t=((seconds%7.4)+7.4)%7.4;
    const stem=smooth(.22,2.7,t),left=smooth(.8,3.4,t),right=smooth(1.15,3.95,t);
    const fade=1-smooth(6.6,7.2,t),stemX=.28+.72*stem;
    context.drawImage(layers.soil,0,0,width,height);
    if(stem>0){
      drawLayer(layers.stem,[.474,.836],stemX,stem,Math.sin(seconds*1.1)*.003,1,1,fade);
      drawLayer(layers.left,[.477,.63],left*.9+left*left*.1,left,.38*(1-left)+Math.sin(seconds*.9)*.007,stemX,stem,fade*Math.min(1,left*8));
      drawLayer(layers.right,[.488,.60],right*.88+right*right*.12,right,-.36*(1-right)+Math.sin(seconds*.9+.7)*.008,stemX,stem,fade*Math.min(1,right*8));
    }
    // Finish on the untouched photograph so every dew drop and leaf edge stays crisp.
    if(t>3.9){context.save();context.globalAlpha=smooth(3.9,4.3,t)*fade;context.drawImage(layers.original,0,0,width,height);context.restore();}
    canvas.dataset.growth=String(Math.min(stem,left,right));
  }
  const ready=context?Promise.all([load('assets/intro-plant.jpg'),load('assets/intro-soil.jpg')]).then(([plant,soil])=>{
    if(disposed)return false;
    width=canvas.width=1280;height=canvas.height=Math.round(width*plant.naturalHeight/plant.naturalWidth);
    const photo=document.createElement('canvas');photo.width=width;photo.height=height;
    const pc=photo.getContext('2d',{willReadFrequently:true});pc.drawImage(plant,0,0,width,height);
    const data=pc.getImageData(0,0,width,height),pixels=data.data,alpha=new Uint8ClampedArray(width*height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const p=y*width+x,i=p*4,r=pixels[i],g=pixels[i+1],b=pixels[i+2];
      const green=g-r*.52-b*.48;
      alpha[p]=(x>width*.22&&x<width*.70&&y>height*.27&&y<height*.85&&g>r*.80&&g>b*1.08)?Math.max(0,Math.min(255,(green-7)*24)):0;
      // Preserve the natural reddish lower stem as well as its green upper part.
      if(y>height*.65&&y<height*.838&&x>width*(.465+(y/height-.65)*.02)&&x<width*.489)alpha[p]=255;
    }
    // Keep the connected seedling and discard similarly colored background specks.
    const connected=new Uint8Array(width*height),queue=new Int32Array(width*height);
    const seed=Math.floor(height*.72)*width+Math.floor(width*.477);
    let head=0,tail=1;queue[0]=seed;connected[seed]=1;
    while(head<tail){
      const p=queue[head++];
      for(const next of [p-1,p+1,p-width,p+width,p-width-1,p-width+1,p+width-1,p+width+1]){
        if(next>=0&&next<alpha.length&&!connected[next]&&alpha[next]>16){connected[next]=1;queue[tail++]=next;}
      }
    }
    for(let p=0;p<alpha.length;p++)if(!connected[p])alpha[p]=0;
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
      const p=y*width+x;
      const neighbors=Math.max(alpha[p],Math.min(alpha[p-1],alpha[p+1]),Math.min(alpha[p-width],alpha[p+width]));
      pixels[p*4+3]=neighbors;
    }
    pc.putImageData(data,0,0);
    layers={soil,original:plant,
      stem:layer(photo,[[.466,.845],[.461,.75],[.465,.66],[.474,.60],[.480,.55],[.482,.535],[.486,.529],[.490,.533],[.493,.542],[.493,.59],[.489,.65],[.488,.75],[.488,.845]]),
      left:layer(photo,[[.22,.27],[.489,.27],[.489,.67],[.22,.67]]),
      right:layer(photo,[[.47,.27],[.70,.27],[.70,.67],[.47,.67]])
    };
    draw(0);scene?.classList.add('ap-photo-ready');return true;
  }).catch(()=>false):Promise.resolve(false);
  return {ready,draw,destroy(){disposed=true;layers=null;}};
}
