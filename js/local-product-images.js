/* Local, read-only photos. No photo bytes or paths are sent to Firebase. */
(() => {
  const $ = id => document.getElementById(id);
  const entries = new Map(), pictures = new Map();
  let directory = null, generation = 0, scheduled = false, busy = false, folderName = '', duplicates = 0;
  const normalize = value => String(value || '').trim().toLowerCase();
  const stem = name => /\.(jpe?g|png|webp)$/i.test(name) ? normalize(name.replace(/\.[^.]+$/, '')) : null;
  const status = text => { $('localPhotosStatus').textContent = text; };

  function storedHandle(action, value) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('josue-local-photo-folder', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('settings');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('settings', action === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('settings');
        let operation;
        try { operation = action === 'get' ? store.get('folder') : action === 'delete' ? store.delete('folder') : store.put(value, 'folder'); }
        catch(error) { db.close();reject(error);return; }
        let result;
        operation.onsuccess = () => { result = operation.result; };
        tx.oncomplete = () => { db.close(); resolve(result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }
  function release(img, state) {
    state.token++;
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = null;
    img.removeAttribute('src');
  }
  const queue = [];
  let running = 0;
  function enqueue(task) {
    queue.push(task); drain();
  }
  function drain() {
    while (running < 4 && queue.length) {
      running++;
      Promise.resolve().then(queue.shift()).catch(() => {}).finally(() => { running--; drain(); });
    }
  }
  function loadImage(img, state) {
    const token = ++state.token;
    enqueue(async () => {
      if (!img.isConnected || !state.visible || state.token !== token) return;
      try {
        const file = await state.source.getFile();
        if (!img.isConnected || !state.visible || state.token !== token) return;
        const url = URL.createObjectURL(file);
        state.url = url;
        img.onerror = () => {
          if (state.url !== url) return;
          release(img, state);img.hidden = true;
          img.parentElement?.classList.remove('has-local-photo');
          status('Alguna foto no se pudo abrir. Revisá el archivo y usá Actualizar fotos; podés seguir vendiendo.');
        };
        img.src = url;
      } catch (error) {
        if (state.token !== token) return;
        img.hidden = true; img.parentElement?.classList.remove('has-local-photo');
        status('No se pudo leer alguna foto. Usá Habilitar / actualizar o volvé a elegir la carpeta.');
      }
    });
  }
  const observer = new IntersectionObserver(changes => {
    for (const change of changes) {
      const state = pictures.get(change.target); if (!state) continue;
      if (change.isIntersecting && !state.visible) {
        state.visible = true; loadImage(change.target, state);
      } else if (!change.isIntersecting && state.visible) {
        state.visible = false; release(change.target, state);
      }
    }
  }, { rootMargin: '120px' });
  function clearPictures() {
    for (const [img, state] of pictures) {
      observer.unobserve(img);release(img, state);
      img.parentElement?.classList.remove('has-local-photo');img.remove();
    }
    pictures.clear();
  }
  function productSource(product, barcodeCounts) {
    const id = normalize(product.id), barcode = normalize(product.barcode);
    if (entries.get(id)) return entries.get(id);
    return barcode && barcodeCounts.get(barcode) === 1 ? entries.get(barcode) : null;
  }
  function scan() {
    scheduled = false;
    for (const [img,state] of pictures) if (!img.isConnected) {
      observer.unobserve(img);release(img,state);pictures.delete(img);
    }
    const products = window.DB.listProducts();
    const byId = new Map(products.map(product => [product.id,product]));
    const barcodeCounts = new Map();
    products.forEach(product => { const code=normalize(product.barcode);if(code)barcodeCounts.set(code,(barcodeCounts.get(code)||0)+1); });
    document.querySelectorAll('#productGrid [data-product-id], #cafeProductGrid .cafe-product-card').forEach(card => {
      const id = card.dataset.productId || card.querySelector('[data-cafe-product-id]')?.dataset.cafeProductId;
      const product = byId.get(id), source = product && productSource(product,barcodeCounts);
      const old = card.querySelector('.local-product-photo');
      if (old && pictures.get(old)?.source === source) return;
      if (old) { const state=pictures.get(old);if(state)release(old,state);observer.unobserve(old);pictures.delete(old);old.remove(); }
      card.classList.remove('has-local-photo');
      if (!source) return;
      const img=document.createElement('img');img.className='local-product-photo';img.alt='';img.decoding='async';img.draggable=false;
      pictures.set(img,{source,token:0,visible:false,url:null});card.prepend(img);card.classList.add('has-local-photo');observer.observe(img);
    });
    if (folderName) {
      const matched=products.filter(product=>productSource(product,barcodeCounts)).length;
      $('localPhotosCount').textContent=`${matched} de ${products.length} productos con foto. ${duplicates ? duplicates+' nombres duplicados: dejá una sola imagen por código.':''}`;
    } else $('localPhotosCount').textContent='';
  }
  function schedule() { if (!scheduled) { scheduled=true;requestAnimationFrame(scan); } }
  function indexFile(name, source) {
    const key=stem(name);if(!key)return;
    if(entries.has(key)){entries.set(key,null);duplicates++;}else entries.set(key,source);
  }
  function setBusy(value) {
    busy=value;['chooseLocalPhotos','refreshLocalPhotos','forgetLocalPhotos'].forEach(id=>$(id).disabled=value);
  }
  async function indexDirectory(handle) {
    const current=++generation;
    setBusy(true);status('Leyendo los nombres de las fotos…');
    clearPictures();entries.clear();duplicates=0;
    try {
      for await (const [name,source] of handle.entries()) {
        if(current!==generation)return;
        if(source.kind==='file')indexFile(name,source);
      }
      folderName=handle.name;status(`Carpeta: ${folderName}. Fotos locales, sin subir a internet.`);schedule();
    } catch(error) { entries.clear();folderName='';status('No se pudo leer la carpeta. Volvé a habilitarla o elegila nuevamente.');schedule(); }
    finally {setBusy(false);}
  }
  $('chooseLocalPhotos').addEventListener('click',async () => {
    if(busy)return;
    if(!window.showDirectoryPicker) { $('localPhotosFiles').click();return; }
    try {
      const handle=await window.showDirectoryPicker({id:'josue-product-photos',mode:'read'});
      directory=handle;await indexDirectory(handle);
      try {await storedHandle('put',handle);} catch {status(`Carpeta: ${handle.name}. Se puede usar ahora; este navegador no pudo recordar la selección.`);}
    } catch(error) {if(error.name!=='AbortError')status('No se pudo abrir el selector. Probá el botón Elegir carpeta (alternativa).');}
  });
  $('fallbackLocalPhotos').addEventListener('click',()=>$('localPhotosFiles').click());
  $('localPhotosFiles').addEventListener('change',async event => {
    if(!event.target.files.length)return;
    generation++;directory=null;clearPictures();entries.clear();duplicates=0;
    const files=Array.from(event.target.files);
    folderName=files[0].webkitRelativePath.split('/')[0] || 'Carpeta seleccionada';
    files.forEach(file=>{if(file.webkitRelativePath.split('/').length<=2)indexFile(file.name,{getFile:async()=>file});});
    event.target.value='';
    try {await storedHandle('delete');} catch {}
    status(`Carpeta: ${folderName}. Selección para esta sesión; al volver a abrir la página elegí la carpeta otra vez.`);schedule();
  });
  $('refreshLocalPhotos').addEventListener('click',async()=>{
    if(busy)return;
    if(!directory){status('Elegí la carpeta para cargar o actualizar las fotos.');return;}
    try {
      if(await directory.requestPermission({mode:'read'})!=='granted'){status('Hace falta autorizar la lectura de la carpeta para ver las fotos.');return;}
      await indexDirectory(directory);
    }catch {status('Volvé a elegir la carpeta: su permiso ya no está disponible.');}
  });
  $('forgetLocalPhotos').addEventListener('click',async()=>{
    generation++;directory=null;folderName='';entries.clear();clearPictures();schedule();
    try {await storedHandle('delete');status('Carpeta desvinculada. No se borró ningún archivo.');}
    catch {status('Fotos desactivadas en esta sesión. No se pudo olvidar la carpeta guardada en el navegador.');}
  });
  $('downloadPhotoNames').addEventListener('click',()=>{
    const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"';
    const rows=[['Producto','Código de barras','Nombre de foto recomendado']];
    window.DB.listProducts().forEach(product=>rows.push([product.name,product.barcode,product.id+'.jpg']));
    const blob=new Blob(['\ufeff'+rows.map(row=>row.map(quote).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='nombres-fotos-productos.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  ['productGrid','cafeProductGrid'].forEach(id=>new MutationObserver(schedule).observe($(id),{childList:true,subtree:true}));
  window.addEventListener('panaderia:store-changed',event=>{if(event.detail?.name==='productsById')schedule();});
  (async()=>{
    const initial=generation;
    try {
      const saved=await storedHandle('get');if(initial!==generation||directory||folderName)return;
      if(!saved)return;directory=saved;
      if(await saved.queryPermission({mode:'read'})==='granted')await indexDirectory(saved);
      else status(`Carpeta guardada: ${saved.name}. Tocá Habilitar / actualizar para permitir la lectura.`);
    }catch {status('Elegí una carpeta para ver las fotos. La selección podría no conservarse al cerrar el navegador.');}
  })();
})();
