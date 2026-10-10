import type { HelpGuidesMessages } from './help-guides.ts';
export const es: HelpGuidesMessages = {
 guides: {
 import: {
 title: 'Crear un vídeo e importar materiales', short: 'Crear e importar', summary: 'Crea un vídeo en Space y lleva los materiales a la biblioteca de materiales y a la línea de tiempo.',
 keywords: 'nuevo crear archivo material biblioteca importar arrastrar soltar audio imagen vídeo',
 steps: [
 ['Crear un vídeo', 'Abre «Space» a la izquierda, haz clic en «Nuevo» → «Nuevo vídeo vacío», elige el proyecto donde crearlo, selecciona una relación de aspecto en Home y haz clic en «Crear vídeo vacío». Si ya tienes un archivo de vídeo o audio, haz clic en «Nuevo vídeo desde archivo»; Home se abre con ese archivo y te permite elegir entre añadir subtítulos o transcribir y traducir. Si aún no tienes un proyecto, abre primero una carpeta de proyecto en Home o pide al agente en una sesión que cree uno por ti.'],
 ['Importar materiales a la biblioteca', 'En el panel derecho del editor, abre «Vídeo», «Audio» o «Imágenes», haz clic en «Importar» y elige archivos, o arrástralos al recuadro discontinuo. Importar solo copia los archivos a la carpeta del vídeo; los originales no se modifican.'],
 ['Colocarlos en la línea de tiempo', 'Haz clic en «+» a la derecha de la fila de un material para colocarlo en el cabezal de reproducción. También puedes arrastrar un material a una fila de la línea de tiempo o arrastrar un archivo de tu ordenador directamente a ella.'],
 ],
 tip: 'Importar y colocar en la línea de tiempo son dos pasos: un material recién importado está en la biblioteca de materiales y aún no aparece en la imagen.', cta: 'Nuevo vídeo desde archivo',
 },
 subtitle: {
 title: 'Añadir subtítulos y revisarlos frase por frase', short: 'Añadir subtítulos', summary: 'Importa un archivo de subtítulos o pide al agente que transcriba; después escucha y corrige los subtítulos.',
 keywords: 'transcribir transcripción reconocimiento srt vtt webvtt ass errata dividir unir buscar reemplazar subtítulos',
 steps: [
 ['Obtener subtítulos primero', 'Abre «Subtítulos» a la derecha. Cuando el vídeo tenga materiales, haz clic en «Generar subtítulos» para transcribir con un modelo de voz local o un servicio en la nube conectado; al terminar, los subtítulos aparecen automáticamente en la imagen. En «Ajustes de transcripción», plegado debajo del botón, puedes cambiar el idioma, el modelo de voz y las pistas de reconocimiento. Si ya tienes un archivo de subtítulos, haz clic en «Importar archivo de subtítulos»; se admiten SRT, WebVTT y ASS. Para indicar quién habla, usa «Herramientas › Transcribir»: despliega «Más opciones» debajo del modelo de voz y activa «Identificar hablantes». MOSS Transcribe distingue a los hablantes por sí solo, por lo que esta opción permanece activada; otros modelos locales necesitan «Diarización de hablantes», que se te pedirá descargar la primera vez que la actives.'],
 ['Hacer clic en una frase y editarla', 'Haz clic en el tiempo de una frase para mover el cabezal de reproducción a ella; haz clic en el texto para editarlo. Enter la divide en dos frases, Backspace al principio de una frase la une a la anterior, Shift+Enter añade un salto de línea dentro de la frase y Esc descarta la edición.'],
 ['Escuchar de nuevo y corregir en todas partes', 'Después de salir del cuadro de texto, pulsa Space para reproducir y comparar el texto con la voz. La parte superior del panel indica cuántas frases superan la velocidad de lectura. Si hay que corregir el mismo error en varios sitios, usa buscar y reemplazar (⌘F / Ctrl+F).'],
 ],
 tip: 'Solo las transcripciones iniciadas desde «Generar subtítulos» aparecen automáticamente en la imagen. Cuando el agente transcribe en una sesión, el resultado se guarda primero como transcripción; vuelve a «Subtítulos» y haz clic en «Generar subtítulos» para usarlo. Si la línea de tiempo tiene varias pistas de subtítulos, usa el desplegable del encabezado «Subtítulos» para elegir cuál editar.', cta: 'Abrir Subtítulos',
 },
 translate: {
 title: 'Añadir una traducción para subtítulos bilingües', short: 'Traducción y bilingüe', summary: 'En el panel Subtítulos, elige un idioma de destino y un modelo de texto; la traducción aparece como una nueva pista de subtítulos.',
 keywords: 'traducir traducción inglés chino bilingüe idioma original comparación glosario modelo texto',
 steps: [
 ['Revisar el original primero', 'La traducción recorre el texto transcrito frase por frase. Corrige primero nombres, términos y errores evidentes de reconocimiento para ahorrar correcciones después. Los subtítulos que traduzcas deben proceder de una transcripción: los archivos de subtítulos importados no tienen tiempos por palabra y no se pueden traducir directamente.'],
 ['Hacer clic en «+ Traducir a…» en la barra de la pista', 'Abre «Subtítulos» a la derecha, haz clic en «+ Traducir a…» en la barra de la pista, elige un idioma de destino y un modelo de texto, añade una indicación de estilo o marca un glosario si lo necesitas y haz clic en el botón de inicio de abajo. Si aún no hay un modelo de texto disponible, conecta primero un servicio en «Modelos › Generación de texto»; los modelos en línea se facturan por token.'],
 ['Revisar la traducción y ajustar la disposición bilingüe', 'Al terminar, la traducción aparece automáticamente en la imagen y puedes deshacerla con un clic en la tarjeta de resultado. En «Lista», cambia a «Original + traducción» para comparar frase por frase; haz clic en una frase traducida para reescribirla. Selecciona un subtítulo; la sección «Bilingüe» de «Propiedades de subtítulos» define qué línea queda arriba y la separación entre ambas.'],
 ],
 tip: '¿Quieres mostrar solo la traducción? Desactiva «Mostrar ambos idiomas» antes de empezar o haz clic en la «×» del original en la barra de la pista para quitarlo de la imagen; el original no se elimina. Después de editar el original, las traducciones afectadas se marcan como «Desactualizado»: reescribir una elimina la marca. También puedes hacer clic en «Actualizar traducciones desactualizadas» en el aviso de la aplicación de escritorio o escribir /refresh en una sesión para que el agente vuelva a traducir esas frases.', cta: 'Abrir Subtítulos',
 },
 export: {
 title: 'Exportar un vídeo, subtítulos o una transcripción', short: 'Exportar', summary: 'Elige una entrega según lo que necesites; para vídeo y audio también puedes exportar solo algunos capítulos o segmentos.',
 keywords: 'exportar guardar descargar mp4 wav mp3 m4a srt vtt ass json markdown transcripción capítulo segmento sonoridad archivo proyecto premiere davinci resolve paquete portable',
 steps: [
 ['Hacer clic en «Exportar» en la barra del vídeo', 'Haz clic en «Exportar» a la derecha de la barra del vídeo del editor. Cada una de las cinco entregas tiene su propia página: Vídeo (MP4), Audio (WAV, MP3 o M4A), Subtítulos (SRT, VTT, ASS o JSON), Transcripción (Markdown o texto sin formato) y Archivo de proyecto (XML para Premiere Pro y DaVinci Resolve o un paquete portable de BaoCut).'],
 ['Elegir un intervalo y confirmar los ajustes', 'Vídeo y audio permiten exportar el vídeo completo, por capítulo, por segmento o con inicio y fin personalizados; subtítulos, transcripciones y archivos de proyecto exportan la secuencia completa. En la página Vídeo, confirma también la resolución, el tamaño del archivo y si quieres incrustar los subtítulos en la imagen; activa la normalización de sonoridad si la necesitas. En la página Subtítulos, marca dos pistas para combinarlas en un archivo de subtítulos bilingües.'],
 ['Iniciar la exportación y esperar a que termine', 'Los archivos se guardan en exports/ del proyecto de forma predeterminada; también puedes hacer clic en «Elegir ubicación» primero. Puedes cerrar el diálogo y seguir trabajando mientras se exporta; el progreso aparece en el botón «Exportar» y también puedes consultarlo en «Tareas en segundo plano». Al terminar, haz clic en «Mostrar en la carpeta» para encontrar el archivo; si falla, el diálogo indica el motivo y el siguiente paso.'],
 ],
 tip: 'Un archivo de subtítulos y un vídeo con subtítulos son dos entregas distintas: el primero se carga en otro programa; el segundo se puede reproducir y compartir directamente.',
 },
 workspace: {
 title: 'Conocer el editor', short: null, summary: 'Mira el resultado en la vista previa, busca momentos en la línea de tiempo y cambia el contenido en el panel derecho.',
 keywords: 'escenario lienzo vista previa línea tiempo panel inspector propiedades pista reproducción encontrar',
 steps: [
 ['Centro: la vista previa', 'Muestra la imagen en el cabezal de reproducción, con el tamaño y la frecuencia de fotogramas del vídeo arriba. Los controles de abajo permiten reproducir, avanzar fotograma a fotograma, deshacer, rehacer y dividir en el cabezal de reproducción.'],
 ['Abajo: la línea de tiempo', 'Haz clic en la línea de tiempo para mover el cabezal de reproducción. Arrastra un clip para cambiar cuándo aparece o moverlo a otra pista, y arrastra sus extremos para recortarlo. Haz clic derecho en un clip para dividirlo, copiarlo, desactivarlo o eliminarlo.'],
 ['Derecha: contenido y propiedades', 'De arriba abajo, la barra vertical tiene Transcripción, Subtítulos, Elementos, Texto, Imágenes, Vídeo, Audio, Marca e Inspector. Seleccionar un clip muestra sus propiedades; sin nada seleccionado, el inspector muestra «Propiedades del vídeo» para todo el vídeo.'],
 ],
 tip: 'Si te equivocas, primero deshaz (⌘Z / Ctrl+Z). «Versiones» en la barra del vídeo abre el historial, donde puedes deshacer un cambio concreto.',
 },
 style: {
 title: 'Ajustar el aspecto de los subtítulos', short: null, summary: 'Selecciona un subtítulo y cambia su posición, estilo de texto y momento de aparición en las propiedades.',
 keywords: 'estilo fuente tamaño color contorno fondo sombra brillo posición bilingüe interlineado puntuación',
 steps: [
 ['Seleccionar un subtítulo', 'Haz clic en un subtítulo de la línea de tiempo; a la derecha aparece «Propiedades de subtítulos». Aquí cambias el estilo de subtítulos; los subtítulos que comparten el mismo estilo cambian juntos.'],
 ['Ajustar la posición y el estilo de texto', '«Posición» ajusta la posición vertical, horizontal y el ancho; «Estilo de texto» ajusta fuente, tamaño, color y alineación, y permite activar fondo, contorno, resplandor y sombra. Al arrastrar, la imagen cambia contigo; el cambio se guarda al soltar.'],
 ['Ajustar cuándo aparecen', '«Antes» y «Después» en «Mostrar» definen cuánto antes de la voz aparece cada frase y cuánto después desaparece; «Puntuación» puede cambiar comas y puntos por espacios.'],
 ],
 tip: 'Si la línea de tiempo tiene subtítulos originales y traducidos, «Propiedades de subtítulos» añade una sección «Bilingüe» para definir qué línea queda arriba y su separación. Si algo sale mal, deshaz (⌘Z / Ctrl+Z).', cta: 'Abrir propiedades de subtítulos',
 },
 elements: {
 title: 'Añadir texto, pegatinas y formas', short: null, summary: 'Añade elementos a la imagen desde el panel derecho y ajusta su posición y estilo en las propiedades.',
 keywords: 'elemento pegatina forma visualizador barra progreso temporizador cuenta atrás onda texto cuadro título rótulo inferior preajuste',
 steps: [
 ['Elegir un elemento', '«Elementos», a la derecha, está organizado en pegatinas, formas y visualizadores, y permite buscar; los visualizadores incluyen barras de progreso, temporizadores y formas de onda. Haz clic en uno para añadirlo a la línea de tiempo: la mayoría empiezan en el cabezal de reproducción; otros, como las barras de progreso, abarcan todo el vídeo.'],
 ['Añadir texto', 'En «Texto», a la derecha, haz clic en «Añadir cuadro de texto» o elige un preajuste como Simple, Título o Rótulo inferior.'],
 ['Ajustar el tiempo y la posición', 'Cada elemento ocupa un intervalo en la línea de tiempo; arrástralo para cambiar cuándo aparece. Al seleccionarlo, el panel derecho muestra sus propiedades; usa «Geometría» para definir posición, tamaño, rotación y volteo con valores.'],
 ],
 tip: 'Con un elemento seleccionado, el panel derecho muestra sus propiedades; pulsa Esc para deseleccionarlo y el inspector vuelve a «Propiedades del vídeo».',
 },
 reframe: {
 title: 'Convertir un vídeo horizontal en vertical', short: null, summary: 'Cambia la relación de aspecto en Propiedades del vídeo; los clips de la imagen se escalan con el lienzo.',
 keywords: 'vertical horizontal relación aspecto 9:16 1:1 4:3 16:9 lienzo encuadre reencuadrar',
 steps: [
 ['Abrir las propiedades del vídeo', 'Pulsa Esc para deseleccionar cualquier clip y abre «Inspector» a la derecha; ahora muestra «Propiedades del vídeo».'],
 ['Elegir otra relación de aspecto', '«Relación de aspecto» ofrece 16:9, 9:16, 1:1 y 4:3. El lado corto permanece igual; los clips de la imagen se mueven y escalan en proporción con el lienzo, los que llenaban el lienzo siguen llenándolo y los clips bloqueados no se mueven.'],
 ['Ajustar el encuadre clip por clip', 'Selecciona un clip que necesite reencuadrarse y ajusta su posición y tamaño en «Geometría» de sus propiedades.'],
 ],
 tip: 'Cambiar la relación de aspecto es una edición normal; si no te gusta, deshaz (⌘Z / Ctrl+Z). Aquí no hay recorte inteligente que encuentre automáticamente el sujeto principal, por lo que debes ajustar el encuadre tú.',
 },
 aitools: {
 title: 'Pedir al agente que organice la transcripción', short: null,
 summary: 'Mejorar, crear capítulos, identificar hablantes, buscar cortes, traducir, doblar y escribir para publicar empieza con / en una sesión o con un botón del panel correspondiente, y se envía al agente de forma predeterminada.',
 keywords: 'IA herramientas barra mejorar párrafo capítulo hablante muletilla pausa retranscribir traducción desactualizada doblaje resumen blog título descripción portada',
 steps: [
 ['Escribir / en una sesión', 'Escribe / al principio de la entrada de la sesión (o elige «Usar una herramienta» en «+») para listar las herramientas disponibles para este vídeo: Pulir transcripción, Generar capítulos, Identificar hablantes, Retranscribir, Buscar cortes, Traducir subtítulos, Actualizar traducciones desactualizadas, Traducir doblaje, Escribir un resumen, Escribir una entrada de blog, Proponer títulos, Escribir una descripción, Crear una portada y Exportar. Elige una, añade tus requisitos detrás y envíala; el agente empieza a trabajar. Si abres un vídeo desde Space, la sesión está en la esquina inferior derecha; estas herramientas no están disponibles en la web.'],
 ['O abrir la pestaña Herramientas de IA', 'La pestaña «Herramientas de IA» del lateral derecho del editor agrupa las herramientas: pulir la transcripción, generar capítulos, identificar hablantes, volver a transcribir y buscar cortes, y luego escribir un resumen, una entrada de blog, títulos, una descripción o una portada; «Buscar cortes» en la barra del modo de corte abre la misma página. Elige una para abrir su página y escoge el ámbito y las opciones. El cuadro de texto de abajo redacta la petición con ellos y lleva adjunto el skill de la herramienta; puedes editarlo. En la fila «Sesión» elige una sesión nueva o la actual y pulsa «Enviar al agente». Traducir subtítulos está en «+ Traducir a…» del panel Subtítulos, y traducir el doblaje en el panel Audio y en el menú de la pista de doblaje; en estos dos eliges un modelo en la página de ajustes y empiezas directamente.'],
 ['Revisar los resultados', 'Cada vez que el agente cambia el vídeo, aparece una tarjeta de cambios en la sesión que puedes deshacer directamente. Pule la transcripción antes de generar capítulos para agruparlos por párrafos. Los resultados de escritura y publicación se leen, eligen y copian en la sesión; no modifican la transcripción. Después de editar el original, usa «Actualizar traducciones desactualizadas» para volver a traducir solo las frases marcadas como «Desactualizado».'],
 ],
 tip: 'Para cualquier cosa que no esté en la lista, dilo directamente en una frase en la sesión. Recorte inteligente y Cortar en vídeos cortos no están disponibles en esta versión.',
 },
 agent: {
 title: 'Pedir al agente que trabaje en tu vídeo', short: null, summary: 'Di lo que quieres en una frase, observa cómo lo hace paso a paso y revisa el resultado.',
 keywords: 'IA asistente agente sesión chat automático aprobación permiso deshacer codex claude',
 steps: [
 ['Conectar un agente primero', 'Abre «Ajustes › Proveedores de agentes». BaoCut detecta Claude Code y Codex en este ordenador; si alguno no está instalado, sigue los pasos de su tarjeta para instalarlo e iniciar sesión y vuelve para detectar de nuevo.'],
 ['Decir lo que quieres en una sesión', 'Crea una sesión en Home o abre un vídeo en Space: en la esquina inferior derecha hay una sesión flotante, expandida de forma predeterminada, donde puedes hablar. Al minimizarla se convierte en un icono en esa esquina; haz clic para expandirla de nuevo. Indica claramente el ámbito y lo que quieres conservar; por ejemplo: «Revisa las erratas de los subtítulos de esta entrevista, pero conserva la redacción conversacional».'],
 ['Observar el proceso y revisar el resultado', 'Puedes desplegar cada paso del agente. Según el modo de acceso que elegiste, te pide permitir o denegar antes de ejecutar comandos o hacer cambios; cada vez que cambia el vídeo, aparece una tarjeta de cambios en la sesión que puedes deshacer directamente.'],
 ],
 tip: 'El agente solo puede usar vídeos de la carpeta de la sesión (la carpeta del proyecto o la propia carpeta de trabajo de la sesión). Al enviar un mensaje, se adjunta un vídeo de este tipo abierto en el editor junto con la selección y el cabezal de reproducción; puedes quitar la referencia encima del cuadro de entrada.', cta: 'Abrir ajustes del agente',
 },
 missing: {
 title: '¿Por qué no veo los subtítulos en la imagen?', short: null, summary: 'Comprueba, en orden, si los subtítulos están en la línea de tiempo, dónde está el cabezal de reproducción y los interruptores de las pistas.',
 keywords: 'no mostrar ausente oculto desactivado vacío no ver subtítulos transcripción',
 steps: [
 ['Comprobar que los subtítulos estén en la línea de tiempo', 'Las transcripciones hechas por el agente o la línea de comandos solo guardan el resultado como transcripción y no cambian la línea de tiempo. Abre «Subtítulos» a la derecha: si dice «Aún no hay subtítulos», haz clic en «Generar subtítulos», importa un archivo de subtítulos o pide al agente que coloque la transcripción en la línea de tiempo.'],
 ['Ir a una frase donde alguien hable', 'Haz clic en el tiempo de una frase en «Subtítulos» y el cabezal de reproducción saltará a ella. Los intervalos sin voz no tienen subtítulos.'],
 ['Comprobar los interruptores de pista y clip', 'Mira el encabezado de la pista de subtítulos: cuando el icono del ojo está desactivado, la pista no se muestra en la vista previa. Los clips desactivados también se omiten en la imagen; haz clic derecho en uno y elige «Activar este clip».'],
 ],
 tip: '¿Aún no los ves? Selecciona el subtítulo y revisa la posición y el color en «Propiedades de subtítulos»: puede que el texto esté fuera de la imagen o se parezca demasiado al fondo.', cta: 'Consultar Subtítulos',
 },
 model: {
 title: 'La transcripción o la generación no empezó. ¿Qué hago?', short: null, summary: 'Primero revisa el motivo en Tareas en segundo plano y añade el servicio de modelos que falta.',
 keywords: 'fallo error transcripción transcribir síntesis voz generación imagen modelo servicio componente red tarea',
 steps: [
 ['Abrir Tareas en segundo plano', '«Tareas en segundo plano», a la izquierda, lista todas las tareas en segundo plano, tanto del editor como de un flujo de Home, del agente o de la línea de comandos. Haz clic en «Detalles» de una tarea: si falló, el título del recuadro rojo indica el motivo.'],
 ['Añadir lo que indiquen los detalles', 'Los detalles indican el siguiente paso según el motivo, como instalar un componente, configurar un modelo en la nube, elegir un modelo predeterminado o comprobar los ajustes del agente.'],
 ['Volver y reintentar', 'Después de corregirlo, vuelve y reintenta: haz clic de nuevo en «Generar subtítulos» en el panel Subtítulos o pide al agente en la sesión que vuelva a enviar la solicitud. Cuando no hay un servicio disponible, el agente indica primero cuál debes activar.'],
 ],
 tip: 'La transcripción, la síntesis de voz y la generación de imágenes necesitan un servicio de modelos. Puedes leer Ayuda sin conexión, pero los servicios en la nube necesitan una conexión de red.', cta: 'Ver modelos',
 },
 },
};
