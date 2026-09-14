(()=>{"use strict";var S={540:n=>{n.exports=function(e){var t=document.createElement("style");return e.setAttributes(t,e.attributes),e.insert(t,e.options),t}},1113:n=>{n.exports=function(e,t){if(t.styleSheet)t.styleSheet.cssText=e;else{for(;t.firstChild;)t.removeChild(t.firstChild);t.appendChild(document.createTextNode(e))}}},1601:n=>{n.exports=function(e){return e[1]}},4503:(n,e,t)=>{t.d(e,{A:()=>i});var o=t(1601),c=t.n(o),a=t(6314),r=t.n(a)()(c());r.push([n.id,`#error-screen {
	display: flex;
	flex-direction: column;
	padding: 10px;
	box-sizing: border-box;
	position: absolute;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	background-color: var(--surface-color);
}

#error-screen > .title {
	font-size: 28px;
	color: var(--text-color);
}

#error-screen > .version, #error-screen > .user-agent {
	font-size: 20px;
	color: var(--text-color);
	opacity: 0.5;
}

#error-screen > textarea {
	height: 100%;
	flex-grow: 1;
	background-color: var(--surface-tertiary-color);
	border: none;
	resize: none;
	color: var(--text-color);
	word-break: break-word;
	font-size: 20px;
}
#error-screen > textarea:focus-visible {
	outline: none;
}
`,""]);const i=r},5056:(n,e,t)=>{n.exports=function(o){var c=t.nc;c&&o.setAttribute("nonce",c)}},5072:n=>{var e=[];function t(a){for(var r=-1,i=0;i<e.length;i++)if(e[i].identifier===a){r=i;break}return r}function o(a,r){for(var i={},d=[],u=0;u<a.length;u++){var p=a[u],f=r.base?p[0]+r.base:p[0],s=i[f]||0,v="".concat(f," ").concat(s);i[f]=s+1;var x=t(v),A={css:p[1],media:p[2],sourceMap:p[3],supports:p[4],layer:p[5]};if(x!==-1)e[x].references++,e[x].updater(A);else{var F=c(A,r);r.byIndex=u,e.splice(u,0,{identifier:v,updater:F,references:1})}d.push(v)}return d}function c(a,r){var i=r.domAPI(r);return i.update(a),function(d){if(d){if(d.css===a.css&&d.media===a.media&&d.sourceMap===a.sourceMap&&d.supports===a.supports&&d.layer===a.layer)return;i.update(a=d)}else i.remove()}}n.exports=function(a,r){var i=o(a=a||[],r=r||{});return function(d){d=d||[];for(var u=0;u<i.length;u++){var p=t(i[u]);e[p].references--}for(var f=o(d,r),s=0;s<i.length;s++){var v=t(i[s]);e[v].references===0&&(e[v].updater(),e.splice(v,1))}i=f}}},6314:n=>{n.exports=function(e){var t=[];return t.toString=function(){return this.map(function(o){var c="",a=o[5]!==void 0;return o[4]&&(c+="@supports (".concat(o[4],") {")),o[2]&&(c+="@media ".concat(o[2]," {")),a&&(c+="@layer".concat(o[5].length>0?" ".concat(o[5]):""," {")),c+=e(o),a&&(c+="}"),o[2]&&(c+="}"),o[4]&&(c+="}"),c}).join("")},t.i=function(o,c,a,r,i){typeof o=="string"&&(o=[[null,o,void 0]]);var d={};if(a)for(var u=0;u<this.length;u++){var p=this[u][0];p!=null&&(d[p]=!0)}for(var f=0;f<o.length;f++){var s=[].concat(o[f]);a&&d[s[0]]||(i!==void 0&&(s[5]===void 0||(s[1]="@layer".concat(s[5].length>0?" ".concat(s[5]):""," {").concat(s[1],"}")),s[5]=i),c&&(s[2]&&(s[1]="@media ".concat(s[2]," {").concat(s[1],"}")),s[2]=c),r&&(s[4]?(s[1]="@supports (".concat(s[4],") {").concat(s[1],"}"),s[4]=r):s[4]="".concat(r)),t.push(s))}},t}},7659:n=>{var e={};n.exports=function(t,o){var c=(function(a){if(e[a]===void 0){var r=document.querySelector(a);if(window.HTMLIFrameElement&&r instanceof window.HTMLIFrameElement)try{r=r.contentDocument.head}catch(i){r=null}e[a]=r}return e[a]})(t);if(!c)throw new Error("Couldn't find a style target. This probably means that the value for the 'insert' parameter is invalid.");c.appendChild(o)}},7825:n=>{n.exports=function(e){if(typeof document=="undefined")return{update:function(){},remove:function(){}};var t=e.insertStyleElement(e);return{update:function(o){(function(c,a,r){var i="";r.supports&&(i+="@supports (".concat(r.supports,") {")),r.media&&(i+="@media ".concat(r.media," {"));var d=r.layer!==void 0;d&&(i+="@layer".concat(r.layer.length>0?" ".concat(r.layer):""," {")),i+=r.css,d&&(i+="}"),r.media&&(i+="}"),r.supports&&(i+="}");var u=r.sourceMap;u&&typeof btoa!="undefined"&&(i+=`
/*# sourceMappingURL=data:application/json;base64,`.concat(btoa(unescape(encodeURIComponent(JSON.stringify(u))))," */")),a.styleTagTransform(i,c,a.options)})(t,e,o)},remove:function(){(function(o){if(o.parentNode===null)return!1;o.parentNode.removeChild(o)})(t)}}}}},b={};function l(n){var e=b[n];if(e!==void 0)return e.exports;var t=b[n]={id:n,exports:{}};return S[n](t,t.exports,l),t.exports}l.n=n=>{var e=n&&n.__esModule?()=>n.default:()=>n;return l.d(e,{a:e}),e},l.d=(n,e)=>{for(var t in e)l.o(e,t)&&!l.o(n,t)&&Object.defineProperty(n,t,{enumerable:!0,get:e[t]})},l.o=(n,e)=>Object.prototype.hasOwnProperty.call(n,e),l.nc=void 0;var k=l(5072),M=l.n(k),N=l(7825),T=l.n(N),$=l(7659),j=l.n($),I=l(5056),O=l.n(I),L=l(540),z=l.n(L),P=l(1113),U=l.n(P),h=l(4503),m={};m.styleTagTransform=U(),m.setAttributes=O(),m.insert=j().bind(null,"head"),m.domAPI=T(),m.insertStyleElement=z(),M()(h.A,m),h.A&&h.A.locals&&h.A.locals;const y=JSON.parse('{"rE":"0.5.1","l$":{"r":2,"M":4}}'),w=y.l$.r;if(!Number.isSafeInteger(w)||w<1)throw new Error("package.json beta version property must be a positive integer");const R=y.rE+"",E=y.l$.M;if(!Number.isSafeInteger(E)||E<1)throw new Error("package.json beta physicsVersion property must be a positive integer");let g=null;function C(n){if(g==null){const e=document.createElement("div");e.id="error-screen",document.body.appendChild(e);const t=document.createElement("div");t.className="title",t.textContent="Oh no! PolyTrack encountered an unexpected error!",e.appendChild(t);const o=document.createElement("div");o.className="version",o.textContent="Version: "+R,e.appendChild(o);const c=document.createElement("div");c.className="user-agent",c.textContent="User Agent: "+navigator.userAgent,e.appendChild(c);const a=document.createElement("textarea");a.readOnly=!0,e.appendChild(a),g={element:e,textArea:a}}g.textArea.value=n+`
`+g.textArea.value}window.addEventListener("error",n=>{C(`${n.message}
Source: ${n.filename}
Line: ${n.lineno.toString()}
Column: ${n.colno.toString()}
`)}),window.addEventListener("unhandledrejection",n=>{let e;n.reason instanceof Error?(e=`Unhandled Rejection:
${n.reason.message}`,n.reason.stack!=null&&(e+=`
Stack:
${n.reason.stack}`)):e=`Unhandled Rejection:
${String(n.reason)}`,C(e)})})();
