// Set this to the HTTPS address of the Timeweb API before publishing.
const ORDER_API_BASE = 'https://81-31-245-8.sslip.io';
const DOCUMENTS_BASE = 'docs/';
let placingOrder = false;
let pendingRequest;
try { pendingRequest = JSON.parse(localStorage.getItem('multibrandia_pending') || 'null'); } catch (_) {}
function alertOrder(text) {
  if (tg.showAlert && tg.initData) tg.showAlert(text); else window.alert(text);
}
function checkoutPayload(mode) {
  return {pay:mode, fio:gv('cFio'),phone:gv('cPhone'),city:gv('cCity'),sdek:gv('cSdek'),
    items:cartList().map(({p,qty})=>({id:p.id,qty})),
    expected_total:cartSubtotal()+deliveryCalc(),
    oferta:document.getElementById('acceptOferta').checked,
    privacy:document.getElementById('acceptPrivacy').checked};
}
function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
function syncPaymentButtons() {
  const enabled = document.getElementById('acceptOferta').checked && document.getElementById('acceptPrivacy').checked && !placingOrder;
  document.getElementById('payFull').disabled=!enabled;
  document.getElementById('payHalf').disabled=!enabled;
}
function renderSummary() {
  const box=document.getElementById('sumItems'); box.replaceChildren();
  cartList().forEach(({p,qty})=>{
    const row=document.createElement('article'); row.className='summary-item';
    const img=document.createElement('img');img.src=p.images[0];img.alt=p.title;
    const info=document.createElement('div'), title=document.createElement('h3'), variant=document.createElement('p'), price=document.createElement('strong');
    title.textContent=p.title;
    variant.textContent=(p.variant || (p.type==='Watch'?(p.title.toLowerCase().includes('petite')?'Размер: Petite':'Размер: стандартный'):'') )+(p.variant||p.type==='Watch'?' · ':'')+'Количество: '+qty;
    price.textContent=fmt(p.price_rub)+' × '+qty+' = '+fmt(p.price_rub*qty);
    info.append(title,variant,price);row.append(img,info);box.appendChild(row);
  });
  const sub=cartSubtotal(), del=deliveryCalc(), total=sub+del;
  const hasAdvents=cartList().some(({p})=>p.type==='Advent');
  document.getElementById('sumSub').textContent=fmt(sub);
  document.getElementById('sumDel').textContent=fmt(del);
  document.getElementById('sumDelRow').hidden=del===0;
  document.getElementById('sumDelLabel').textContent=hasAdvents?'Доставка часов и украшений':'Доставка СДЭК';
  document.getElementById('adventDeliveryNotice').hidden=!hasAdvents;
  document.getElementById('sumTotal').textContent=fmt(total);
  document.getElementById('fullBtn').textContent=fmt(total);
  document.getElementById('halfBtn').textContent=fmt(Math.ceil(total/2))+' сейчас · остаток '+fmt(total-Math.ceil(total/2));
  document.getElementById('orderResult').textContent='';
  syncPaymentButtons();
}
async function placeOrder(mode) {
  if(placingOrder) return;
  const payload=checkoutPayload(mode);
  if(!payload.oferta || !payload.privacy) return alertOrder('Подтвердите оба документа');
  if(!payload.items.length) return alertOrder('Корзина пуста');
  if(previewMode) return alertOrder('Это просмотр: заказ не отправлен. Для настоящего заказа откройте настроенный магазин через бота.');
  if(!tg.initData) return alertOrder('Откройте магазин через Telegram-бота');
  const snapshot=JSON.stringify(payload);
  if(pendingRequest && pendingRequest.snapshot!==snapshot) {
    return alertOrder('Есть запрос с неизвестным результатом. Вернитесь к прежним данным и повторите оплату либо обратитесь в поддержку, прежде чем создавать другой заказ.');
  }
  if(!ORDER_API_BASE.startsWith('https://')) return alertOrder('Приём заказов ещё настраивается. Обратитесь в поддержку.');
  pendingRequest=pendingRequest || {snapshot, key:newKey()};
  try { localStorage.setItem('multibrandia_pending',JSON.stringify(pendingRequest)); }
  catch (_) { return alertOrder('Не удалось сохранить запрос. Разрешите хранилище приложения и повторите.'); }
  placingOrder=true; syncPaymentButtons();
  const result=document.getElementById('orderResult'); result.textContent='Сохраняем заказ…';
  try {
    const response=await fetch(ORDER_API_BASE.replace(/\/$/,'')+'/api/orders', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...payload, request_key:pendingRequest.key, init_data:tg.initData}),
      signal:AbortSignal.timeout(30000)});
    const data=await response.json();
    if(!data.ok) {
      if(response.status===400) { pendingRequest=null; localStorage.removeItem('multibrandia_pending'); }
      throw new Error(data.error || 'Не удалось сохранить заказ');
    }
    const order=data.order;
    cart={}; saveCart(); pendingRequest=null; localStorage.removeItem('multibrandia_pending');
    result.textContent=`Заказ №${order.id} принят. Перейдите в банковское приложение для оплаты. Подтверждение заказа и кнопка поддержки придут в чат бота.`;
    document.getElementById('paymentOptions').style.display='none';
    document.getElementById('consents').style.display='none';
    if(order.manual_amount) {
      const notice=document.createElement('p');
      notice.textContent='В банковском приложении введите сумму '+fmt(order.due)+' самостоятельно. Перед подтверждением проверьте получателя и сумму.';
      result.appendChild(notice);
    }
    const again=document.createElement('a'); again.href=order.payment_url; again.target='_blank'; again.rel='noopener';
    again.textContent='Перейти к оплате '+fmt(order.due); again.className='btn wine'; result.appendChild(again);
    try { tg.openLink(order.payment_url); } catch (_) { /* The visible link allows payment to be reopened. */ }
  } catch(err) {
    result.textContent=err.name==='TimeoutError' || err.name==='TypeError'
      ? 'Ответ не получен. Корзина сохранена. Повторите тот же запрос: второй заказ не создастся.' : err.message;
  } finally { placingOrder=false; syncPaymentButtons(); }
}

let consentVersion='';
let consentReady=false;
let savingConsents=false;
function syncGate(){
 document.getElementById('gateContinue').disabled=!consentReady||savingConsents||!['gatePrivacy','gateOferta','gateAdvertising'].every(id=>document.getElementById(id).checked);
}
async function consentRequest(path,payload){
 const response=await fetch(ORDER_API_BASE+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,init_data:tg.initData}),signal:AbortSignal.timeout(20000)});
 const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Не удалось сохранить согласия');return data;
}
function closeGate(){document.getElementById('consentGate').style.display='none';document.body.style.overflow='';}
async function checkConsents(){
 const status=document.getElementById('gateStatus');document.getElementById('gateRetry').style.display='none';
 if(previewMode){consentReady=true;consentVersion='preview';status.textContent='Предпросмотр: согласия не записываются.';syncGate();return;}
 if(!tg.initData){status.textContent='Откройте каталог через Telegram-бота, чтобы подтвердить согласия.';return;}
 try{const data=await consentRequest('/api/consents/status',{});consentVersion=data.version;consentReady=true;if(data.accepted)closeGate();else status.textContent='';syncGate();}
 catch(_){status.textContent='Не удалось проверить согласия. Повторите проверку.';document.getElementById('gateRetry').style.display='block';}
}
document.body.style.overflow='hidden';
['gatePrivacy','gateOferta','gateAdvertising'].forEach(id=>document.getElementById(id).addEventListener('change',syncGate));
document.getElementById('gateRetry').onclick=checkConsents;
document.getElementById('gateContinue').onclick=async()=>{
 if(document.getElementById('gateContinue').disabled)return;
 if(previewMode){closeGate();return;}
 savingConsents=true;syncGate();
 try{await consentRequest('/api/consents/accept',{version:consentVersion,privacy:true,oferta:true,advertising:true});closeGate();}
 catch(err){document.getElementById('gateStatus').textContent=err.message;}
 finally{savingConsents=false;syncGate();}
};
checkConsents();
