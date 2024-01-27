var canvas = document.querySelector("canvas")
var gl = canvas.getContext("webgl2", {antialias: false})

// q < 1: low res
// q > 1: functionally multisampling
var q = 1.5

// First orientation
var cameraQuat = [0.37938171860820763, 0.2710725711850891, 0.0824679508389416, -0.8807884024108209]
var cameraRadiusTarget = 2
var cameraRadius = cameraRadiusTarget

function shader(type, src) {
	var id = gl.createShader(type)
	gl.shaderSource(id, src)
	gl.compileShader(id)
	if(!gl.getShaderParameter(id, gl.COMPILE_STATUS)) {
		console.log("Error compiling shader: ")
		console.log(gl.getShaderInfoLog(id))
		gl.deleteShader(id)
		return null
	}
	return id
}

function program() {
	var id = gl.createProgram()
	for(var i = 0; i < arguments.length; i++) {
		gl.attachShader(id, arguments[i])
	}
	gl.linkProgram(id)
	if(!gl.getProgramParameter(id, gl.LINK_STATUS)) {
		console.log("Error linking shader program:")
		console.log(gl.getProgramInfoLog(id))
		gl.deleteShader(id)
		return null
	}
	return id
}

function loadtex(srgb, url) {
	var id = gl.createTexture()
	
	gl.bindTexture(gl.TEXTURE_2D, id)
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
	
	var img = new Image()
	
	// Lazy loading
	img.onload = function() {
		gl.bindTexture(gl.TEXTURE_2D, id)
		gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
	}
	
	img.src = url
	
	return id
}

function rotatevec(vec, axis, angle) {
	var dot = vec[0] * axis[0] + vec[1] * axis[1] + vec[2] * axis[2]
	return [
		vec[0] * Math.cos(angle) + (axis[1] * vec[2] - axis[2] * vec[1]) * Math.sin(angle) + axis[0] * dot * (1 - Math.cos(angle)),
		vec[1] * Math.cos(angle) + (axis[2] * vec[0] - axis[0] * vec[2]) * Math.sin(angle) + axis[1] * dot * (1 - Math.cos(angle)),
		vec[2] * Math.cos(angle) + (axis[0] * vec[1] - axis[1] * vec[0]) * Math.sin(angle) + axis[2] * dot * (1 - Math.cos(angle))
	]
}

function onarcball(x, y, sensitivity) {
	x = x / window.innerWidth * 2 - 1
	y = 1 - y / window.innerHeight * 2
	var dot = x * x + y * y
	if(dot < 1) {
		return [x, y, Math.sqrt(1 - dot), 0]
	} else {
		var len = Math.sqrt(dot)
		return [x / len,  y / len, 0, 0]
	}
}

var dragOn = false, dragX, dragY, dragXLast, dragYLast

canvas.onmousedown = function(e) {
	dragOn = true
	dragX = e.clientX
	dragY = e.clientY
}
canvas.onmousemove = function(e) {
	if(dragOn) {
		dragXLast = dragX
		dragYLast = dragY
		
		dragX = e.clientX
		dragY = e.clientY
		
		arcLast = glMatrix.vec4.transformQuat([], onarcball(dragXLast, dragYLast), cameraQuat)
		arc = glMatrix.vec4.transformQuat([], onarcball(dragX, dragY), cameraQuat)
		
		// Rotation difference
		var quat = glMatrix.vec3.cross([], arc, arcLast)
		quat[3] = Math.sqrt((glMatrix.vec3.length(arc) ** 2) * (glMatrix.vec3.length(arcLast) ** 2)) + glMatrix.vec3.dot(arc, arcLast)
		glMatrix.quat.normalize(quat, quat)
		
		// Apply
		glMatrix.quat.multiply(cameraQuat, quat, cameraQuat)
	}
}
canvas.onmouseup = function(e) {
	if(dragOn) {
		dragOn = false
	}
}
canvas.onwheel = function(e) {
	var c = cameraRadiusTarget * (1.1 ** Math.sign(e.deltaY))
	if(c > 1.5 && c < 1500) {
		cameraRadiusTarget = c
	}
}

var texs = {
	diffuse: loadtex(true, "diffuse4.jpg"),
	debug: loadtex(true, "debug.png"),
	night: loadtex(true, "night4.jpg"),
	bump: loadtex(false, "bump4.jpg"),
	spec: loadtex(false, "spec4.jpg"),
	clouds: loadtex(false, "clouds4.jpg"),
	sky: loadtex(true, "sky.png")
}

var buf = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, buf)

// Full-screen quad
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

var raym = program(shader(gl.VERTEX_SHADER, `
	attribute vec2 aPos;
	
	varying highp vec2 vPos;
	
	void main() {
		vPos = aPos;
		gl_Position = vec4(aPos, 0.0, 1.0);
	}
`), shader(gl.FRAGMENT_SHADER, `
	precision highp float;
	
	#define PI 3.141592653589793
	
	uniform sampler2D uEarthDiffuse;
	uniform sampler2D uEarthBump;
	uniform sampler2D uEarthNight;
	uniform sampler2D uEarthSpec;
	uniform sampler2D uEarthClouds;
	uniform sampler2D uSky;
	
	uniform vec4 uDat;
	uniform mat4 uCam;
	
	#define uTime uDat.x
	#define uRatio uDat.y
	
	varying vec2 vPos;
	
	float rand(vec3 p) {
		return fract(sin(dot(p, vec3(12.345, 67.89, 412.12))) * 42123.45) * 2.0 - 1.0;
	}
	
	float mod289(float x) {
		return x - floor(x * (1.0 / 289.0)) * 289.0;
	}
	vec4 mod289(vec4 x) {
		return x - floor(x * (1.0 / 289.0)) * 289.0;
	}
	vec4 perm(vec4 x) {
		return mod289(((x * 34.0) + 1.0) * x);
	}
	
	float noise(vec3 p){
		vec3 a = floor(p);
		vec3 d = p - a;
		d = d * d * (3.0 - 2.0 * d);
		
		vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);
		vec4 k1 = perm(b.xyxy);
		vec4 k2 = perm(k1.xyxy + b.zzww);
		
		vec4 c = k2 + a.zzzz;
		vec4 k3 = perm(c);
		vec4 k4 = perm(c + 1.0);
		
		vec4 o1 = fract(k3 * (1.0 / 41.0));
		vec4 o2 = fract(k4 * (1.0 / 41.0));
		
		vec4 o3 = o2 * d.z + o1 * (1.0 - d.z);
		vec2 o4 = o3.yw * d.x + o3.xz * (1.0 - d.x);
		
		return o4.y * d.y + o4.x * (1.0 - d.y);
	}
	
	float fbm(vec3 q) {
		float w = 0.5;
		float ret = 0.0;
		
		const mat3 m = mat3(
			0.8168387, 0.5092981, 0.2709058,
			-0.5514276, 0.5514418, 0.6259709,
			0.1694170, -0.6607022, 0.7312800
		);
		
		q += uTime * 0.00008;
		
		for (int i = 0; i < 16; i++) {
			ret += w * noise(q); 
			q = m * q * 1.95 + 14.5;
			w *= 0.5;
		}
		
		return ret;
	}
	
	vec2 equirectangular(vec3 g) {
		return vec2(1.0 - (0.5 + atan(g.z, g.x)) / (2.0 * PI), 0.5 + asin(-g.y) / PI);
	}
	
	bool sphereray(vec3 center, float radius, vec3 ro, vec3 rd, out float t, out vec3 i) {
		vec3 oc = ro - center;
		float b = dot(oc, rd);
		float c = dot(oc, oc) - radius * radius;
		if(c > 0.0 && b > 0.0) {
			return false;
		}
		float D = b * b - c;
		if(D < 0.0) {
			return false;
		}
		t = max(0.0, -b - sqrt(D));
		i = ro + rd * t;
		return true;
	}
	
	void main() {
		vec3 eye = uCam[3].xyz;
		vec3 up = uCam[1].xyz;
		vec3 forward = -uCam[2].xyz;
		vec3 right = uCam[0].xyz;
		
		vec3 rd = normalize(forward + right * vPos.x * uRatio + up * vPos.y);
		
		vec3 atmos = vec3(0.4, 0.6, 1.0);
		
		vec3 light = normalize(vec3(sin(uTime / 10000.0), cos(uTime / 40000.0) * 0.25, cos(uTime / 10000.0)));
		
		float t;
		vec3 i;
		if(sphereray(vec3(0), 1.0, eye, rd, t, i)) {
			vec3 g = normalize(i);
			
			vec2 uv = equirectangular(g);
			
			float clouds = clamp((fbm(g * 13.0) - 1.0 + texture2D(uEarthClouds, uv).r) * 2.0, 0.0, 1.0);
			
			vec3 day = mix(texture2D(uEarthDiffuse, uv).rgb, vec3(1), clouds);
			vec3 night = mix(texture2D(uEarthNight, uv).rgb, vec3(0), clouds);
			
			vec3 nrm = normalize(vec3(
				-(texture2D(uEarthBump, uv + vec2(-0.00025, 0)).r - texture2D(uEarthBump, uv + vec2(0.00025, 0)).r),
				0.3,
				-(texture2D(uEarthBump, uv + vec2(0, -0.00025)).r - texture2D(uEarthBump, uv + vec2(0, 0.00025)).r)
			));
			vec3 tangent = vec3(g.z, g.y, -g.x);
			vec3 bitangent = cross(nrm, tangent);
			
			mat3 tbn = mat3(g, tangent, bitangent);
			
			vec3 worldNormal = tbn * nrm;
			
			float diffuse = max(dot(worldNormal, light), 0.0);
			float specular = texture2D(uEarthSpec, uv).r * pow(max(dot(worldNormal, normalize(light - rd)), 0.0), 16.0) * 0.8;
			
			vec3 col;
			col = day + specular;
			col = mix(col, atmos, max(0.1, pow(1.0 - dot(g, -rd), 2.5)));
			col = mix(night, col, diffuse);
			col = col;
			
			gl_FragColor = vec4(col, 1);
		} else {
			gl_FragColor = vec4(texture2D(uSky, equirectangular(rd)).rgb, 1);
		}
	}
`))

gl.useProgram(raym)

gl.enableVertexAttribArray(0)
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

gl.uniform1i(gl.getUniformLocation(raym, "uEarthDiffuse"), 0)
gl.uniform1i(gl.getUniformLocation(raym, "uEarthBump"), 1)
gl.uniform1i(gl.getUniformLocation(raym, "uEarthNight"), 2)
gl.uniform1i(gl.getUniformLocation(raym, "uEarthSpec"), 3)
gl.uniform1i(gl.getUniformLocation(raym, "uEarthClouds"), 4)
gl.uniform1i(gl.getUniformLocation(raym, "uSky"), 5)

var datUni = gl.getUniformLocation(raym, "uDat")
var camUni = gl.getUniformLocation(raym, "uCam")

gl.enable(gl.SAMPLE_COVERAGE)

var lastTime = null
function render(currentTime) {
	var dt = lastTime ? (currentTime - lastTime) : 0
	lastTime = currentTime
	
	cameraRadius = cameraRadius * 0.9 + cameraRadiusTarget * 0.1;
	
	gl.activeTexture(gl.TEXTURE0 + 0)
	gl.bindTexture(gl.TEXTURE_2D, texs.diffuse)
	gl.activeTexture(gl.TEXTURE0 + 1)
	gl.bindTexture(gl.TEXTURE_2D, texs.bump)
	gl.activeTexture(gl.TEXTURE0 + 2)
	gl.bindTexture(gl.TEXTURE_2D, texs.night)
	gl.activeTexture(gl.TEXTURE0 + 3)
	gl.bindTexture(gl.TEXTURE_2D, texs.spec)
	gl.activeTexture(gl.TEXTURE0 + 4)
	gl.bindTexture(gl.TEXTURE_2D, texs.clouds)
	gl.activeTexture(gl.TEXTURE0 + 5)
	gl.bindTexture(gl.TEXTURE_2D, texs.sky)
	
	canvas.width = window.innerWidth * q
	canvas.height = window.innerHeight * q
	canvas.style.width = window.innerWidth + "px"
	canvas.style.height = window.innerHeight + "px"
	gl.viewport(0, 0, canvas.width, canvas.height)
	gl.uniform4f(datUni, currentTime, canvas.width / canvas.height, 0, 0)
	
	var mat = glMatrix.mat4.fromQuat([], cameraQuat)
	glMatrix.mat4.translate(mat, mat, [0, 0, cameraRadius])
	gl.uniformMatrix4fv(camUni, false, mat)
	
	gl.drawArrays(gl.TRIANGLES, 0, 6)
	
	requestAnimationFrame(render)
}
requestAnimationFrame(render)