FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY vendor/ /usr/share/nginx/html/vendor/
COPY css/ /usr/share/nginx/html/css/
COPY js/ /usr/share/nginx/html/js/
