/* Browser ES module for a frontend served on an approved same-site origin.
   The browser manages Origin and HttpOnly cookies; this is not a Node cookie jar. */
export const newRequestKey=()=>Array.from(crypto.getRandomValues(new Uint8Array(20)),value=>value.toString(16).padStart(2,'0')).join('');
export class SaleSyncClient {
  constructor(baseURL='/api/v1'){this.baseURL=baseURL.replace(/\/$/,'');this.csrfToken=null;}
  async request(path,{method='GET',body,idempotencyKey,signal}={}){
    const response=await fetch(this.baseURL+path,{method,credentials:'include',signal,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(this.csrfToken?{'X-CSRF-Token':this.csrfToken}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error?.message||'API request failed.'),data.error,{status:response.status});
    if(Object.hasOwn(data,'csrfToken'))this.csrfToken=data.csrfToken;return data;
  }
  session(){return this.request('/auth/session');}
  login(email,password){return this.request('/auth/login',{method:'POST',body:{email,password}});}
  async logout(){const result=await this.request('/auth/logout',{method:'POST',body:{}});this.csrfToken=null;return result;}
  products(filters={}){return this.request('/products?'+new URLSearchParams(filters));}
  orders(page=1,limit=20){return this.request('/orders?'+new URLSearchParams({page,limit}));}
  quote(body){return this.request('/orders/quote',{method:'POST',body});}
  createOrder(body,idempotencyKey){return this.request('/orders',{method:'POST',body,idempotencyKey});}
  refund(orderId,body,idempotencyKey){return this.request('/admin/orders/'+encodeURIComponent(orderId)+'/refund',{method:'POST',body,idempotencyKey});}
}
