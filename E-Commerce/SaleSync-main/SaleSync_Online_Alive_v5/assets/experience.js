/* Presentation, browser history and accessibility for the existing storefront.
   Uses existing render/navigation/actions; does not perform business API requests. */
(() => {
  'use strict';
  const app=document.querySelector('#app');
  const pages=new Set(['home','shop','cart','wishlist','compare','sellers','store','login','register','account','orders','checkout','seller-apply','seller-center','forgot-password','policies','help']);
  const initialHash=location.hash;
  let initialized=false,restoring=false,rendering=false,lastRoute='',lastPage='',pending=0;
  const previousRender=render,previousOverlay=openOverlay;
  const paths={
    home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    shop:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    wishlist:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
    cart:'<path d="M2 3h3l2.2 12h11.5l2-8H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
    account:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    orders:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>'
  };
  const icon=name=>`<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]||paths.account}</svg>`;
  const chrome=document.createElement('div');
  chrome.innerHTML='<a class="ui-skip" href="#main-content">Skip to main content</a><div class="ui-network" aria-hidden="true"></div><div class="ui-request-label" role="status" aria-live="polite"><span class="ui-spinner" aria-hidden="true"></span><span>Loading…</span></div><span class="sr-only" id="ui-page-announcement" role="status" aria-live="polite"></span>';
  document.body.append(chrome);

  function publicSnapshot(){return {attributes:ui.attributes||{},subcategory:ui.subcategory||'',searchScope:ui.searchScope||'category',catalogPage:ui.catalogPage||1,orderPage:ui.orderPage||1,page:ui.page,category:ui.category,query:ui.query,sort:ui.sort,maxPrice:ui.maxPrice,seller:ui.seller,inStock:ui.inStock,focusStore:ui.focusStore,paymentOrderId:ui.page==='checkout'?ui.paymentOrderId:null,accountSection:app.querySelector('[data-commerce-tab].active')?.dataset.commerceTab};}
  function activeRoute(){
    const active=app.querySelector('[data-api-tab].active');
    if(active)return {page:'admin',tab:active.dataset.apiTab,listPage:ui.staffListPage||1};
    return publicSnapshot();
  }
  function routeHash(route){
    const params=new URLSearchParams();
    if(route.page==='shop'){
      for(const [key,value,fallback] of [['category',route.category,'All'],['subcategory',route.subcategory,''],['scope',route.searchScope,'category'],['q',route.query,''],['sort',route.sort,'featured'],['max',route.maxPrice,''],['seller',route.seller,'All']])if(value!==undefined&&String(value)!==fallback)params.set(key,String(value));
      if(route.attributes&&Object.keys(route.attributes).length)params.set('attributes',JSON.stringify(route.attributes));
      if(route.inStock)params.set('stock','1');
      if(route.catalogPage>1)params.set('page',String(route.catalogPage));
    }
    if(route.page==='admin'&&route.listPage>1)params.set('page',String(route.listPage));
    if(route.page==='account'&&route.orderPage>1&&(!route.accountSection||route.accountSection==='orders'))params.set('page',String(route.orderPage));
    if(route.page==='store')params.set('store',route.focusStore);
    if(route.page==='checkout'&&route.paymentOrderId)params.set('order',route.paymentOrderId);
    if(route.page==='account'&&route.accountSection&&route.accountSection!=='orders')params.set('tab',route.accountSection);
    const path=route.page==='admin'?'admin/'+(route.tab||'overview'):route.page;
    return '#/'+path+(params.size?'?'+params.toString():'');
  }
  function readRoute(hash=location.hash){
    const [path,query='']=hash.replace(/^#\/?/,'').split('?');
    if(path.startsWith('admin/'))return {page:'admin',tab:path.slice(6),listPage:Math.max(1,Number(new URLSearchParams(query).get('page'))||1)};
    if(!pages.has(path))return null;
    const p=new URLSearchParams(query);let attributes={};try{const value=JSON.parse(p.get('attributes')||'{}');if(value&&typeof value==='object'&&!Array.isArray(value))attributes=Object.fromEntries(Object.entries(value).filter(([key,item])=>key.length<=50&&typeof item==='string'&&item.length<=200).slice(0,8));}catch{}
    return {attributes,catalogPage:Math.max(1,Number(p.get('page'))||1),orderPage:Math.max(1,Number(p.get('page'))||1),page:path,subcategory:p.get('subcategory')||'',searchScope:p.get('scope')||'category',category:p.get('category')||'All',query:p.get('q')||'',sort:p.get('sort')||'featured',maxPrice:p.get('max')||'',seller:p.get('seller')||'All',inStock:p.get('stock')==='1',focusStore:p.get('store')||ui.focusStore,paymentOrderId:p.get('order'),accountSection:p.get('tab')||'orders'};
  }
  function updateHistory(replace=false){
    const route=activeRoute();
    if(!pages.has(route.page)&&route.page!=='admin')return;
    const hash=routeHash(route);
    if(hash===lastRoute)return;
    const current=history.state||{};
    const next={...current,salesyncNavigation:route,scrollY:0};
    history[replace||!lastRoute?'replaceState':'pushState'](next,'',location.pathname+location.search+hash);
    lastRoute=hash;
  }
  function restoreRoute(route,scrollY=0){
    if(!route||ui.page==='verify')return false;
    if(route.page==='admin'){
      const tab=[...app.querySelectorAll('[data-api-tab]')].find(button=>button.dataset.apiTab===route.tab);
      if(!tab)return false;
      const changedPage=(ui.staffListPage||1)!==(route.listPage||1);
      window.dispatchEvent(new CustomEvent('salesync:restore-list',{detail:{tab:route.tab,page:route.listPage||1}}));
      if(!tab.classList.contains('active')||changedPage){restoring=true;tab.click();return true;}
      return false;
    }
    // Keep role and page guards in the original implementation.
    if(app.querySelector('.api-workspace'))return false;
    if(route.page==='checkout'&&route.paymentOrderId&&document.body.classList.contains('api-mode')){restoring=true;lastRoute=location.hash;window.dispatchEvent(new CustomEvent('salesync:restore-payment',{detail:{orderId:route.paymentOrderId}}));return true;}
    if(route.page==='checkout'&&!route.paymentOrderId)window.dispatchEvent(new Event('salesync:checkout-fresh'));
    if(route.page==='account')window.dispatchEvent(new CustomEvent('salesync:restore-list',{detail:{page:route.orderPage||1}}));
    if(route.page==='shop')window.dispatchEvent(new CustomEvent('salesync:restore-list',{detail:{catalog:true}}));
    if(route.page==='account')window.dispatchEvent(new CustomEvent('salesync:restore-account',{detail:{tab:route.accountSection||'orders'}}));
    restoring=true;
    Object.assign(ui,{attributes:route.attributes||{},subcategory:route.subcategory||'',searchScope:route.searchScope||'category',catalogPage:route.catalogPage||1,orderPage:route.orderPage||1,category:route.category||'All',query:route.query||'',sort:route.sort||'featured',maxPrice:route.maxPrice||'',seller:route.seller||'All',inStock:!!route.inStock,focusStore:route.focusStore||ui.focusStore});
    setPage(route.page);
    window.scrollTo({top:scrollY,behavior:'instant'});
    return true;
  }
  function addLabels(root){
    root.querySelectorAll('.field').forEach((field,index)=>{
      const label=field.querySelector('label'),input=field.querySelector('input:not([type=hidden]),select,textarea');
      if(label&&input&&!label.htmlFor){input.id||='ui-field-'+index;label.htmlFor=input.id;}
    });
  }
  let passwordFieldSequence=0;
  function addPasswordToggles(root){
    root.querySelectorAll('input[type="password"]').forEach(input=>{
      if(input.hasAttribute('data-password-field'))return;
      input.dataset.passwordField='true';input.id||='ui-password-'+(++passwordFieldSequence);
      const wrapper=document.createElement('div');wrapper.className='ui-password-control';
      input.before(wrapper);wrapper.append(input);
      const toggle=document.createElement('button');toggle.type='button';toggle.className='ui-password-toggle';toggle.dataset.passwordToggle='';
      toggle.textContent='Show';toggle.setAttribute('aria-controls',input.id);toggle.setAttribute('aria-label','Show '+(input.labels?.[0]?.textContent.trim()||'password'));toggle.setAttribute('aria-pressed','false');
      wrapper.append(toggle);
    });
  }
  function decorate(){
    document.body.dataset.uiPage=ui.page;
    const main=app.querySelector('.page');
    if(main){main.id='main-content';main.setAttribute('role','main');main.tabIndex=-1;main.setAttribute('aria-busy',String(pending>0));}
    app.querySelectorAll('.actions button').forEach(button=>{
      const label=button.querySelector('span');
      button.innerHTML=icon(button.dataset.page==='wishlist'?'wishlist':button.dataset.page==='cart'?'cart':'account')+(label?.outerHTML||'');
    });
    app.querySelectorAll('.mobilebar button').forEach(button=>{const b=button.querySelector('b');if(b)b.innerHTML=icon(button.dataset.page);});
    app.querySelectorAll('.navline button,.mobilebar button').forEach(button=>{
      const category=button.dataset.category;
      const active=category?ui.page==='shop'&&ui.category===category:button.dataset.page===ui.page&&(ui.page!=='shop'||ui.category==='All');
      if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    });
    app.querySelectorAll('.appnav button').forEach(button=>{if(button.classList.contains('active'))button.setAttribute('aria-current','page');});
    app.querySelectorAll('[data-wish]').forEach(button=>button.setAttribute('aria-pressed',String(db.wish.includes(button.dataset.wish))));
    app.querySelectorAll('[data-compare]').forEach(button=>button.setAttribute('aria-pressed',String(db.compare.includes(button.dataset.compare))));
    app.querySelectorAll('.crumb').forEach(crumb=>{crumb.setAttribute('role','navigation');crumb.setAttribute('aria-label','Breadcrumb');});
    app.querySelectorAll('.table-wrap').forEach(table=>{table.tabIndex=0;table.setAttribute('role','region');table.setAttribute('aria-label','Scrollable data table');});
    app.querySelectorAll('th').forEach(th=>th.setAttribute('scope','col'));
    addLabels(app);
    addPasswordToggles(app);
  }
  function captureForm(){
    const fields=[];
    app.querySelectorAll('#apiRegisterForm input,#apiLoginForm input,#apiCheckoutForm input').forEach(input=>{if(!input.hasAttribute('data-password-field')&&!['password','hidden'].includes(input.type))fields.push({form:input.form.id,name:input.name,value:input.value});});
    return fields;
  }
  function focusSnapshot(){
    const target=document.activeElement;if(!app.contains(target))return null;
    const attr=[...target.attributes].find(a=>a.name.startsWith('data-')&&!['data-page'].includes(a.name));
    return {id:target.id,attr:attr?[attr.name,attr.value]:null,selectionStart:target.selectionStart,selectionEnd:target.selectionEnd};
  }
  render=()=>{
    if(rendering)return previousRender();
    const fields=captureForm(),focus=focusSnapshot(),pageBefore=lastPage;
    rendering=true;
    try{previousRender();}finally{rendering=false;}
    if(app.querySelector('.api-loading'))return;
    if(!initialized){
      initialized=true;decorate();
      if(restoreRoute(readRoute(initialHash)))return;
    }
    const currentPage=activeRoute().page;
    if(pageBefore===currentPage){
      for(const field of fields){const input=document.getElementById(field.form)?.elements.namedItem(field.name);if(input)input.value=field.value;}
      let target=focus?.id?document.getElementById(focus.id):null;
      if(!target&&focus?.attr)target=[...app.querySelectorAll('['+focus.attr[0]+']')].find(el=>el.getAttribute(focus.attr[0])===focus.attr[1]);
      if(target){target.focus({preventScroll:true});if(typeof focus.selectionStart==='number'&&target.setSelectionRange&&['text','search','tel','url','password'].includes(target.type))target.setSelectionRange(focus.selectionStart,focus.selectionEnd);}
    }
    decorate();
    updateHistory(restoring);restoring=false;
    if(pageBefore&&pageBefore!==currentPage){
      const heading=app.querySelector('.page h1,.page h2');
      if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});document.getElementById('ui-page-announcement').textContent=heading.textContent;}
    }
    lastPage=currentPage;
  };
  openOverlay=(...args)=>{previousOverlay(...args);const body=document.getElementById('modalBody');addLabels(body);addPasswordToggles(body);};
  document.addEventListener('click',event=>{
    const toggle=event.target.closest('[data-password-toggle]');if(!toggle)return;
    event.preventDefault();event.stopImmediatePropagation();
    const input=toggle.parentElement.querySelector('input[data-password-field]');if(!input)return;
    const reveal=input.type==='password';input.type=reveal?'text':'password';toggle.textContent=reveal?'Hide':'Show';
    toggle.setAttribute('aria-label',(reveal?'Hide ':'Show ')+(input.labels?.[0]?.textContent.trim()||'password'));toggle.setAttribute('aria-pressed',String(reveal));
  },true);
  document.addEventListener('input',event=>{
    if(event.target.form?.id==='apiCheckoutForm'&&event.target.name)ui.shipping[event.target.name]=event.target.value;
  });
  document.querySelector('.ui-skip').addEventListener('click',event=>{event.preventDefault();document.getElementById('main-content')?.focus();});
  window.addEventListener('click',()=>{if(initialized)history.replaceState({...history.state,scrollY:window.scrollY},'',location.href);},true);
  window.addEventListener('salesync:request',event=>{
    pending=event.detail.pending;document.body.classList.toggle('request-pending',pending>0);
    document.getElementById('main-content')?.setAttribute('aria-busy',String(pending>0));
    document.querySelector('.ui-request-label>span:last-child').textContent=pending>0?(event.detail.method==='GET'?'Loading…':'Saving…'):'Complete';
  });
  window.addEventListener('popstate',event=>{
    // Recovery links carry a one-time token and are handled by the live account UI.
    if(location.hash.startsWith('#/reset-password?'))return;
    if(ui.overlay)closeOverlay();
    const route=event.state?.salesyncNavigation||readRoute();
    if(!restoreRoute(route,event.state?.scrollY||0)){lastRoute='';updateHistory(true);}
  });
  window.addEventListener('hashchange',()=>{if(location.hash!==lastRoute&&readRoute())restoreRoute(readRoute());});
  // Early live startup is still loading; this wrapper handles the eventual API render.
  if(!app.querySelector('.api-loading'))render();
})();
