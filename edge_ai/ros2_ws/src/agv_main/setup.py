from setuptools import find_packages, setup

package_name = 'agv_main'

setup(
    name=package_name,
    version='0.0.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='VE-com team',
    maintainer_email='user@todo.todo',
    description='AGV Main Control Package',
    license='Apache-2.0',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            'auto_drive = agv_main.auto_drive:main',
            # 下の2つは中身が空ファイルなので現在は無効化している。
            # 実装したら行頭の # を外すこと。
            # 'mqtt_bridge = agv_main.mqtt_bridge:main',
            # 'serial_bridge = agv_main.serial_bridge:main',
        ],
    },
)
