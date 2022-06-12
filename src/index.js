import {useSyncExternalStore,useCallback,useState} from 'react';

let handlers = {};
let bindings = {};
let links = {};
let reverse = {};
let current = {};
let delta = {};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let blocked = false;

export async function serialize(cb){
  let result;
  while(blocked){
    await sleep(100);
  }

  blocked = true;
  try{ result = await cb(); }catch(e){}
  blocked = false;

  return result;
}

let enumerateBindings = 0;

export function appiKeys(o)
{
  return Object.keys(o).filter(k=>!k.startsWith('_'));
}

export function appiMeta(o)
{
  return Object.keys(o).filter(k=>k.startsWith('_'));
}

export function clearBindings()
{
  handlers = {};
  bindings = {};
  reverse = {};
  links = {};
}

export function bind(rid,tsx,mutation,handler)
{
  const lid = enumerateBindings++;

  if(!(rid in bindings)){
    bindings[rid] = {tsx};
    handlers[rid] = handler; // The first binding defines the handler. A single resource can't be bound by two separate handlers ATM.
  }


  links[lid] = {mutation,rid};

  if(!(rid in reverse))
    reverse[rid] = {};

  reverse[rid][lid] = true;

  return lid;
}

export function unbind(lid)
{
  if(!(lid in links))
    return;

  const rid = links[lid].rid;

  delete reverse[rid][lid];

  if(Object.keys(reverse[rid]).length == 0)
  {
    delete reverse[rid];

    //When to forget a bind? Right now never:
    //delete bindings[rid];
    //delete current[rid];
  }
  
  delete links[lid];
}

function realId(qid)
{
  if(qid.startsWith('@'))
    return qid;

  let seg = qid.split('.');
  seg.pop();
  return seg.join('.');
}

function QualifyId(id,ext)
{
  if(id.startsWith("@"))
    return id;

  if(!ext)
    ext = "*";
  
  return id+"."+ext;
}

async function refreshBinding(newBindings)
{
  for(const [rid,bind] of Object.entries(newBindings))
  {
    if(bind.dirty){
      const handler = handlers[rid] ? loadHandler(handlers[rid]) : window.AppiClient;
      if(bind.ltsx)
      {
        let result = await handler.Pull(QualifyId(rid),-1);

        if(result && result !== 22)
        {
          console.log("FAILED BIND PULL",rid, result);
          continue;
        }
      }

      let s = await handler.Get(QualifyId(rid));

      if(!s.length)
      {
        console.log("FAILED BIND GET",rid);
        continue;
      }

      current[rid] = JSON.parse(s);

      for(const lid of Object.keys(reverse[rid] || {}))
        links[lid]?.mutation(current[rid]);

      bindings[rid].tsx = bind.stsx;
    }
  }
}

function merge(target, source) {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) 
        Object.assign(target, { [key]: {} });
      merge(target[key], source[key]);
    } else
      Object.assign(target, { [key]: source[key] });
  }

  return target;
}

export function useAppi(qid, init, _onValue, _onInit, handler){
  const rid = realId(qid);
  let value = current[rid] || init || {};
  let lid = -1;

  if(!current[rid]) serialize(async ()=> await PollNow());

  const store = useSyncExternalStore(
      useCallback((callback)=>{
        if(lid == -1)
        {
          lid = bind(rid,0,(newValue)=>{
            value=newValue;
            callback(newValue);
            if(_onValue) _onValue(newValue)
          },handler)

          if(_onInit) _onInit(x=>{value=x;callback(x);},lid,value);
        }

        return (e)=>{
          lid = -1;
          unbind(lid);
        }
      }),
      useCallback(() => {
        return value;
      })
    );

  const mutation = useCallback((updates,commit)=>{
    serialize(async ()=>
    {
      await window.AppiClient.Upsert(qid,JSON.stringify(updates));
      if(commit)
        await window.AppiClient.Push(qid);
    });
  });

  return [store,mutation];
}

export function useHandler(qid,init,handler)
{
  return useAppi(qid,init,null,null,handler);
}

export function useOptimistic(qid,init,auto)
{
  const [dirty,setDirty] = useState(false);

  const rid = realId(qid);
  let lid = -1;

  const [store,_mutation] = useAppi(qid,init,()=>{},(_cb,_lid,_value)=>lid = _lid);

  const setStore = useCallback((updates,commit)=>{
    if(auto)
      _mutation(updates,commit);
    else
    {
      delta[rid] = merge(delta[rid] || {},updates);
      setDirty(true);
    }

    current[rid] = merge(JSON.parse(JSON.stringify(current[rid])),updates);
    links[lid]?.mutation(current[rid]);
  });

  const flush = useCallback((commit)=>{
    if(dirty){
      _mutation(delta[rid],commit);
      setDirty(false);
      delete delta[rid];
    }
  });

  const clear = useCallback(()=>{
    if(dirty){
      setDirty(false);
      delete delta[rid];
    }
  });

  return {store,setStore,flush,dirty,clear};
}

let pollTimeout = null;
async function Poll()
{
  if(!polling)
    return;

  if(window.AppiClient)
  {
    serialize(async ()=>
    {
      let _newBindings = await window.AppiClient.Bind(JSON.stringify(bindings));

      if(_newBindings)
      {
        let newBindings=JSON.parse(_newBindings);
  
        await refreshBinding(newBindings);
      }
    });
  }

  if(polling)
    pollTimeout = setTimeout(Poll,10000);
}

async function PollNow()
{
  if(!polling)
    return;

  if(pollTimeout)
    clearTimeout(pollTimeout);
  
  await Poll();
}

let polling = false;
function startPoll()
{
  polling = true;
  setTimeout(Poll,1000);
}

function stopPoll()
{
  polling = false;
}

export function getAppi(){
  return window.Appi;
}

export function getAppiClient(){
  return window.AppiClient;
}

export function onAppiClient(callback){
  let interval = setInterval(()=>{
    const client = getAppiClient();
    if(client){
      clearInterval(interval);
      callback(client);
    }
  }, 200);
}

let eventHandlers = {};
let eventEnumerator = 0;

export function registerEventHandler(callback){
  const id = eventEnumerator++;

  eventHandlers[id] = callback;

  return id;
}

export function removeEventHandler(id){
  delete eventHandlers[id];
}

function propagateEvent(type,params){
  for(const handler of Object.values(eventHandlers))
    handler(type,params);
}


var onLoginEvent = undefined;
export function onLogin(callback){
  onLoginEvent=callback;
}

var onLogoutEvent = undefined;
export function onLogout(callback){
  onLogoutEvent=callback;
}

var onNoAccountEvent = undefined;
export function onNoAccount(callback){
  onNoAccountEvent=callback;
}

export function logout(){
  stopPoll();
  clearBindings();
  window.AppiClient.SetAuthenticationDetails("","","");
  window.AppiClient.ClearCache();
  window.localStorage.removeItem("token");
  window.localStorage.removeItem("user");
  if(onLogoutEvent)onLogoutEvent();
  propagateEvent("logout");
  loggedIn = false;
}

export function signup(user,password)
{
  return new Promise( (a,r) => {
    window.AppiClient.AsyncCreateUser(user,password);
    let interval = setInterval(()=>{
      let result = window.AppiClient.Ready();
      if(result !== -1)
      {
        clearInterval(interval);
        a(result);
      }
    },500)
  });
}

export let loggedIn = false;

export async function login(user,password,token,remember)
{
  if(token){
    const result = await window.AppiClient.ValidateUser(user,"",token);
    
    if(!result){
      window.AppiClient.SetAuthenticationDetails(user,"",token);

      startPoll();

      if(onLoginEvent) onLoginEvent(window.AppiClient);
      
      propagateEvent("login",window.AppiClient);

      return loggedIn = true;
    }
    else
    {
      if (onNoAccountEvent) onNoAccountEvent();
      propagateEvent("noAccount",window.AppiClient);
    }
  }
  else {
    const result = await window.AppiClient.ValidateUser(user,password,"");
    
    if(!result){
      window.AppiClient.SetAuthenticationDetails(user,password,"");

      startPoll();

      if(remember){
        window.localStorage.token = window.AppiClient.CreateUserToken();
        window.localStorage.user = user;
      }

      if(onLoginEvent) onLoginEvent(window.AppiClient);

      propagateEvent("login",window.AppiClient);

      return loggedIn = true;
    }
    else
    {
      if (onNoAccountEvent) onNoAccountEvent();
      propagateEvent("noAccount",window.AppiClient);
    }
  }

  return false;
}

let loadingAppi;
export function loadAppiClient(host,callback,autoLogin,library,logging){
    if(loadingAppi)
      return loadingAppi;

    if(!host)
      host="http://localhost:8099"

    if(!library)
      library = "/appi2.js"

    return loadingAppi = new Promise( (a,r) => {
      if(window.AppiClient)
      {
        a(window.AppiClient);
        if(callback) callback(window.AppiClient);
        return;
      }

      const appiScript = document.createElement('script');
      appiScript.onload = async (e) => 
      {
        const Appi = await window.createAppi();
        await Appi.ready;
        Appi.StartupStorage();
        await Appi.storagePromise;
        
        window.Appi = Appi;
        window.AppiClient = new Appi.AppiClient(JSON.stringify({network:{primary_host:host}}));
        window.AppiClient.SetLogging(logging || 0);

        a(window.AppiClient);
        if(callback) callback(window.AppiClient);

        if(autoLogin&&window.localStorage.token&&window.localStorage.user)
          login(window.localStorage.user,"",window.localStorage.token);
        else
        {
          if (onNoAccountEvent) onNoAccountEvent();
          propagateEvent("noAccount",window.AppiClient);
        }
      };
      appiScript.onerror = r;
      appiScript.src = library;

      document.head.appendChild(appiScript);
    });
}

let isBasic = false;
export function loadBasic({host,callback,autoLogin,logging})
{
    isBasic = true;
    return loadAppiClient(host,callback,autoLogin,"/appi2basic.js",logging);
}

export function loadAppi({host,callback,autoLogin,logging})
{
    return loadAppiClient(host,callback,autoLogin,"/appi2.js",logging);
}

let admin = undefined;
export function loadAppiAdmin(host,secret){
  if(!host)
    host="http://localhost:8099"

  if(admin) admin.delete();
  admin = new window.Appi.AppiAdmin(JSON.stringify({network:{primary_host:host}}));
  //admin.SetAuthenticationDetails("",secret)

  return admin;
}

let manager = undefined;
export function loadAppiManager(host,secret){
  if(!host)
    host="http://localhost:8099"

  if(manager) manager.delete();
  manager = new window.Appi.AppiManager(JSON.stringify({network:{primary_host:host}}));
  //admin.SetAuthenticationDetails("",secret)

  return manager;
}

export function loadHandler({type,host,secret})
{
  switch(type){
    case "manager": return manager || loadAppiManager(host,secret);
    case "admin": return manager || loadAppiAdmin(host,secret);
    default: return null;
  }
}

export function lookupHandler(type)
{
  switch(type){
    case "manager": return manager;
    case "admin": return admin;
    default: return null;
  }
}